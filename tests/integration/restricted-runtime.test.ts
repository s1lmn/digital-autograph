import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  openSync,
  closeSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { scram, fileHash, fingerprint } from '../../deploy/manual-deploy.mjs';
import {
  createDatabase,
  migrate,
  createPgProviderIdentityRepository,
  createPgWallRepository,
  createPgAgeDeclarationRepository,
  createPgAutographRepository,
  createPgAutographProcessingRepository,
  createPgAutographModerationRepository,
  createPgFreeClaimRepository,
  createPgPlacementHistoryRepository,
  createPgNotificationRepository,
  createPgOAuthAttemptCleanup,
} from '../../packages/db/src/index';
import {
  AutographService,
  ModerationService,
} from '../../packages/autographs/src/index';
import { createPrivateS3Storage } from '../../packages/integrations/src/index';
import { processOneAutographJob } from '../../apps/worker/src/worker';
import { WallService } from '../../packages/walls/src/index';
import { notificationCycle } from '../../packages/notifications/src/index';

const base = process.env.TEST_DATABASE_URL!;
if (
  !base ||
  new URL(base).pathname !== '/autograph_test' ||
  !['localhost', '127.0.0.1'].includes(new URL(base).hostname)
)
  throw Error('Isolated loopback test PostgreSQL required');
const name = 'destka_roles_' + randomBytes(6).toString('hex');
const url = new URL(base);
url.pathname = '/' + name;
const controlDb = createDatabase(base),
  adminDb = createDatabase(url.href);
const control = controlDb.pool,
  admin = adminDb.pool;
const passwords = Array.from({ length: 3 }, () =>
  randomBytes(32).toString('hex'),
);
const roleDbs = ['api', 'worker', 'migrator'].map((role, i) => {
  const u = new URL(url);
  u.username = 'da_' + role;
  u.password = passwords[i]!;
  return createDatabase(u.href);
});
const pools = roleDbs.map((d) => d.pool);
const [api, worker, migrator] = pools as [
  typeof admin,
  typeof admin,
  typeof admin,
];
const dir = mkdtempSync(path.join(os.tmpdir(), 'destka-roles-'));
const privateBucket = 'destka-restricted-' + randomUUID();
const storage = createPrivateS3Storage({
  endpoint: process.env.S3_ENDPOINT!,
  bucket: privateBucket,
  region: 'us-east-1',
  accessKeyId: process.env.S3_ACCESS_KEY_ID!,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
});
let created = false;
let rolesOwned = false;
beforeAll(async () => {
  expect(
    (
      await control.query(
        "SELECT rolname FROM pg_roles WHERE rolname IN ('da_api','da_worker','da_migrator')",
      )
    ).rows,
  ).toHaveLength(0);
  await control.query(`CREATE DATABASE ${name}`);
  created = true;
  const journal = JSON.parse(
    readFileSync('packages/db/drizzle/meta/_journal.json', 'utf8'),
  );
  journal.entries = journal.entries.slice(0, 17);
  mkdirSync(path.join(dir, 'meta'));
  writeFileSync(path.join(dir, 'meta/_journal.json'), JSON.stringify(journal));
  for (const e of journal.entries)
    copyFileSync(
      `packages/db/drizzle/${e.tag}.sql`,
      path.join(dir, e.tag + '.sql'),
    );
  await migrate(adminDb.db, { migrationsFolder: dir });
  // Seed genuine pre-0017 rows, including deterministic legacy output adoption.
  await storage.bootstrapLocalBucket();
  const legacyUser = randomUUID(),
    legacyAutograph = randomUUID(),
    legacyOriginal = randomUUID(),
    legacyJob = randomUUID();
  await admin.query('INSERT INTO users(id) VALUES ($1)', [legacyUser]);
  await admin.query(
    "INSERT INTO autographs(id,user_id,source,status) VALUES($1,$2,'canvas','awaiting_approval')",
    [legacyAutograph, legacyUser],
  );
  await admin.query(
    "INSERT INTO autograph_assets(id,autograph_id,role,status,storage_key,expected_content_type,expected_size_bytes,verified_size_bytes,uploaded_at,upload_expires_at) VALUES($1,$2,'original','uploaded',$3,'image/png',4,4,now(),now()+interval '5 minutes')",
    [
      legacyOriginal,
      legacyAutograph,
      `autographs/${legacyAutograph}/original/${legacyOriginal}`,
    ],
  );
  await admin.query(
    "INSERT INTO autograph_processing_jobs(id,autograph_id,original_asset_id,status,attempts,finished_at) VALUES($1,$2,$3,'succeeded',1,now())",
    [legacyJob, legacyAutograph, legacyOriginal],
  );
  await admin.query(
    "INSERT INTO autograph_assets(autograph_id,role,status,storage_key,actual_content_type,verified_size_bytes,width,height,uploaded_at) VALUES($1,'cleaned','uploaded',$2,'image/png',4,1,1,now())",
    [legacyAutograph, `autographs/${legacyAutograph}/cleaned/${legacyJob}.png`],
  );
  const { S3Client, PutObjectCommand } =
    await import('../../packages/integrations/src/file-backup');
  const legacyStorage = new S3Client({
    endpoint: process.env.S3_ENDPOINT!,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
  try {
    for (const key of [
      `autographs/${legacyAutograph}/original/${legacyOriginal}`,
      `autographs/${legacyAutograph}/cleaned/${legacyJob}.png`,
    ])
      await legacyStorage.send(
        new PutObjectCommand({
          Bucket: privateBucket,
          Key: key,
          Body: Buffer.from([0, 255, 128, 42]),
        }),
      );
  } finally {
    legacyStorage.destroy();
  }

  const settings = ['api', 'worker', 'migrator']
    .map((role, i) => `SET destka.${role}_scram='${scram(passwords[i]!)}';`)
    .join('\n');
  await admin.query(
    settings + readFileSync('deploy/postgres-bootstrap.sql', 'utf8'),
  );
  rolesOwned = true;
  const migrationUrl = new URL(url);
  migrationUrl.username = 'da_migrator';
  migrationUrl.password = passwords[2]!;
  const migration = spawnSync(
    process.execPath,
    [path.resolve('packages/db/node_modules/drizzle-kit/bin.cjs'), 'migrate'],
    {
      cwd: path.resolve('packages/db'),
      env: { ...process.env, APP_ENV: 'test', DATABASE_URL: migrationUrl.href },
      encoding: 'utf8',
      timeout: 30000,
    },
  );
  expect(migration.status, 'Non-superuser Drizzle CLI migration failed').toBe(
    0,
  );

  await admin.query(readFileSync('deploy/postgres-runtime.sql', 'utf8'));
  expect(
    (
      await worker.query(
        'SELECT count(*)::int AS n FROM autograph_processing_artifacts WHERE adopted_at IS NOT NULL',
      )
    ).rows[0].n,
  ).toBe(1);
}, 60000);
afterAll(async () => {
  const rows = created
    ? await admin.query('SELECT storage_key FROM autograph_assets')
    : { rows: [] };
  for (const row of rows.rows) await storage.deleteObject(row.storage_key);
  const { S3Client, DeleteBucketCommand } =
    await import('../../packages/integrations/src/file-backup');
  const cleanupStorage = new S3Client({
    endpoint: process.env.S3_ENDPOINT!,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
  try {
    await cleanupStorage.send(
      new DeleteBucketCommand({ Bucket: privateBucket }),
    );
  } finally {
    cleanupStorage.destroy();
  }
  storage.close();
  await Promise.all(pools.map((p) => p.end()));
  await admin.end();
  if (created) await control.query(`DROP DATABASE ${name} WITH (FORCE)`);
  if (rolesOwned)
    for (const role of ['da_api', 'da_worker', 'da_migrator'])
      await control.query(`DROP ROLE IF EXISTS ${role}`);
  await control.end();
  rmSync(dir, { recursive: true, force: true });
});
it('migrates populated baseline with a non-superuser owner; separate runtime roles cannot own/DDL/admin', async () => {
  expect(
    (
      await migrator.query(
        'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations',
      )
    ).rows[0].n,
  ).toBe(24);
  for (const p of pools)
    expect(
      (
        await p.query(
          'SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user',
        )
      ).rows[0],
    ).toEqual({
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolbypassrls: false,
    });
  for (const p of [api, worker])
    for (const sql of [
      'CREATE TABLE public.escape(id int)',
      'CREATE TEMP TABLE escape(id int)',
      'TRUNCATE users',
      'SET ROLE da_migrator',
      'CREATE ROLE escape',
      "COPY users TO PROGRAM 'false'",
      'ALTER TABLE users DISABLE TRIGGER ALL',
    ])
      await expect(p.query(sql)).rejects.toMatchObject({ code: '42501' });
  for (const sql of [
    'DELETE FROM legal_evidence_events',
    'UPDATE creator_earnings SET amount_minor=0',
    "INSERT INTO user_roles(user_id,role) VALUES (gen_random_uuid(),'admin')",
  ])
    await expect(api.query(sql)).rejects.toMatchObject({ code: '42501' });
  await expect(
    worker.query('SELECT * FROM payment_orders'),
  ).rejects.toMatchObject({ code: '42501' });
  await migrate(roleDbs[2]!.db, { migrationsFolder: 'packages/db/drizzle' });
});
it('rejects a different runtime role password over the real TCP connection', async () => {
  const badUrl = new URL(url);
  badUrl.username = 'da_api';
  badUrl.password = passwords[1]!;
  const bad = createDatabase(badUrl.href);
  try {
    await expect(bad.checkConnection()).rejects.toMatchObject({
      code: '28P01',
    });
  } finally {
    await bad.close();
  }
});
it('runs identity → private upload → worker → approval → moderation → concurrent Free Claim → history using only restricted app pools', async () => {
  const identities = createPgProviderIdentityRepository(api);
  const user = await identities.resolveOrCreateUser('google', randomUUID());
  expect(
    await identities.resolveOrCreateUser(
      'google',
      (
        await api.query(
          'SELECT provider_user_id FROM social_identities WHERE user_id=$1',
          [user],
        )
      ).rows[0].provider_user_id,
    ),
  ).toBe(user);
  const service = new AutographService(
    createPgAutographRepository(api),
    storage,
    300,
  );
  const draft = await service.create(user, 'canvas');
  const bytes = await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const upload = await service.initiateUpload(user, draft.id, {
    contentType: 'image/png',
    sizeBytes: bytes.length,
  });
  await service.uploadOriginal(
    user,
    draft.id,
    upload.assetId,
    'image/png',
    async () => bytes,
    new AbortController().signal,
  );
  await service.completeUpload(user, draft.id);
  expect(
    await processOneAutographJob({
      repository: createPgAutographProcessingRepository(worker),
      storage,
      leaseSeconds: 60,
      pollIntervalMs: 1000,
      cleanupGraceSeconds: 3600,
    }),
  ).toBe(true);
  const preview = await service.preview(user, draft.id);
  await service.approveCleanedAutograph(user, draft.id, preview.assetId);
  const moderator = randomUUID(),
    creator = randomUUID();
  await admin.query('INSERT INTO users(id) VALUES ($1)', [moderator]);
  await admin.query(
    "INSERT INTO user_roles(user_id,role) VALUES ($1,'moderator')",
    [moderator],
  );
  const moderation = new ModerationService(
    createPgAutographModerationRepository(api),
    storage,
  );
  await moderation.decide(moderator, draft.id, { decision: 'approved' });
  await admin.query('INSERT INTO creators(id,owner_user_id) VALUES ($1,$2)', [
    creator,
    user,
  ]);
  await admin.query(
    "INSERT INTO creator_profiles(creator_id,slug,display_name) VALUES ($1,$2,'Synthetic')",
    [creator, randomUUID()],
  );
  const walls = new WallService(createPgWallRepository(api));
  const createdWall = await walls.createWall(user, creator, {
    slotCount: 1,
    startAt: null,
    endAt: null,
  });
  await walls.updateWall(user, createdWall.id, { slotCount: 2 });
  const resized = await walls.updateWall(user, createdWall.id, {
    slotCount: 1,
  });
  await walls.transitionWall(user, createdWall.id, 'publish');
  const wall = createdWall.id,
    slot = resized.slots[0]!.id;
  await createPgAgeDeclarationRepository(api).declareAdult(user);
  const claims = createPgFreeClaimRepository(api);
  const result = await Promise.all(
    Array.from({ length: 6 }, () =>
      claims.claimFreeSlot({
        userId: user,
        wallId: wall,
        slotId: slot,
        autographId: draft.id,
      }),
    ),
  );
  expect(result.filter((x) => x.created)).toHaveLength(1);
  expect(
    await createPgPlacementHistoryRepository(api).listUserHistory(user),
  ).toHaveLength(1);
  await notificationCycle(createPgNotificationRepository(worker));
  await createPgOAuthAttemptCleanup(worker)();
}, 30000);

it('verifies the real database dump and actual private bytes with the off-VM restore command; source remains unchanged', async () => {
  const { backupPrivateFiles, S3Client } =
    await import('../../packages/integrations/src/file-backup');
  const ids = spawnSync(
    'docker',
    ['ps', '--filter', 'ancestor=postgres:17-alpine', '--format', '{{.ID}}'],
    { encoding: 'utf8' },
  )
    .stdout.trim()
    .split(/\s+/);
  expect(ids).toHaveLength(1);
  const source = ids[0]!;
  const image = spawnSync(
    'docker',
    ['inspect', '--format', '{{.Image}}', source],
    { encoding: 'utf8' },
  ).stdout.trim();
  const stateSql = readFileSync('deploy/database-state.sql', 'utf8');
  const query = stateSql.slice(stateSql.indexOf('SELECT json_build_object'));
  const snapshot = (await admin.query(query)).rows[0].json_build_object;
  const archive = path.join(dir, 'database.dump'),
    fd = openSync(archive, 'wx', 0o600);
  try {
    const r = spawnSync(
      'docker',
      [
        'exec',
        source,
        'pg_dump',
        '-U',
        new URL(base).username,
        '-d',
        name,
        '--format=custom',
      ],
      { stdio: ['ignore', fd, 'pipe'] },
    );
    expect(r.status, r.stderr?.toString()).toBe(0);
  } finally {
    closeSync(fd);
  }
  const record = path.join(dir, 'record.json');
  writeFileSync(
    record,
    JSON.stringify({
      databaseArchiveSha256: fileHash(archive),
      sourceHostname: 'synthetic-source-host',
      baselineHash: fingerprint(snapshot),
    }),
    { mode: 0o600 },
  );
  const endpoint = process.env.S3_ENDPOINT!,
    accessKeyId = process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey = process.env.S3_SECRET_ACCESS_KEY!;
  const client = new S3Client({
      endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket = privateBucket;
  const files = path.join(dir, 'files');
  try {
    await backupPrivateFiles(client, bucket, files, 1024 * 1024, endpoint);
    const config = path.join(dir, 'config.json'),
      proof = path.join(dir, 'proof.json');
    writeFileSync(
      config,
      JSON.stringify({
        postgresImage: image,
        endpoint,
        accessKeyId,
        secretAccessKey,
        reviewedBy: 'synthetic-local-test',
      }),
      { mode: 0o600 },
    );
    const r = spawnSync(
      'pnpm',
      [
        'exec',
        'tsx',
        'scripts/verify-manual-backup.mts',
        record,
        archive,
        files,
        config,
        proof,
      ],
      { encoding: 'utf8', timeout: 60000 },
    );
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(readFileSync(proof, 'utf8'))).toMatchObject({
      databaseRestorePassed: true,
      filesRestorePassed: true,
      offVm: true,
    });
    expect(
      fingerprint((await admin.query(query)).rows[0].json_build_object),
    ).toBe(fingerprint(snapshot));
  } finally {
    client.destroy();
  }
}, 65000);
