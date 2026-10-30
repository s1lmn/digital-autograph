import { createServer } from 'node:net';
import { renderEnvironment } from '../../deploy/manual-env.mjs';
import { loadPaymentConfig } from '../../packages/config/src/index';
import { loadApiStartupConfig } from '../../apps/api/src/startup-config';
import { spawn, spawnSync } from 'node:child_process';
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
import {
  scram,
  fileHash,
  fingerprint,
  sqlScript,
} from '../../deploy/manual-deploy.mjs';
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

  // Previously valid runtime roles with stale direct and default grants.
  await admin.query(
    'CREATE ROLE da_api NOSUPERUSER; CREATE ROLE da_worker NOSUPERUSER',
  );
  rolesOwned = true;
  await admin.query(`GRANT CREATE,TEMPORARY ON DATABASE ${name} TO da_api,da_worker;
    GRANT CREATE,USAGE ON SCHEMA public TO da_api,da_worker;
    GRANT EXECUTE ON FUNCTION pg_catalog.pg_read_file(text) TO da_api,da_worker;
    GRANT UPDATE(status) ON users TO da_api;
    ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO da_api,da_worker;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO da_api,da_worker;`);
  const settings = ['api', 'worker', 'migrator']
    .map((role, i) => `SET destka.${role}_scram='${scram(passwords[i]!)}';`)
    .join('\n');
  await admin.query(
    settings + sqlScript(path.resolve('deploy'), 'postgres-bootstrap.sql'),
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

  await migrate(roleDbs[2]!.db, { migrationsFolder: 'packages/db/drizzle' });
  await migrator.end();
  await admin.query(sqlScript(path.resolve('deploy'), 'postgres-runtime.sql'));
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
  await Promise.all([api, worker].map((p) => p.end()));
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
      await admin.query(
        'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations',
      )
    ).rows[0].n,
  ).toBe(24);
  for (const role of ['da_api', 'da_worker', 'da_migrator'])
    expect(
      (
        await admin.query(
          'SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1',
          [role],
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
});
it('normalizes stale direct function/schema/database/column grants and permissive defaults, preserving normal runtime', async () => {
  for (const role of ['da_api', 'da_worker']) {
    const result = await admin.query(
      `SELECT has_database_privilege($1,current_database(),'CREATE') AS ddl,
      has_database_privilege($1,current_database(),'TEMP') AS temp,
      has_schema_privilege($1,'public','CREATE') AS schema,
      has_function_privilege($1,'pg_catalog.pg_read_file(text)','EXECUTE') AS file`,
      [role],
    );
    expect(result.rows[0]).toEqual({
      ddl: false,
      temp: false,
      schema: false,
      file: false,
    });
  }
  await expect(
    api.query("SELECT pg_catalog.pg_read_file('/synthetic-never-read')"),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    worker.query("SELECT pg_catalog.pg_read_file('/synthetic-never-read')"),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    api.query("UPDATE users SET status='active'"),
  ).rejects.toMatchObject({ code: '42501' });
  const stale = await admin.query(
    `SELECT count(*)::int AS n FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) a WHERE a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('da_api','da_worker'))`,
  );
  expect(stale.rows[0].n).toBe(0);
});
it('rejects SECURITY DEFINER escalation and unreviewed routine ownership before ownership/schema changes', async () => {
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `CREATE FUNCTION public.review_escalate() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN ALTER ROLE da_api SUPERUSER; END $$; GRANT EXECUTE ON FUNCTION public.review_escalate() TO da_api`,
    );
    // Demonstrate that the stale ACL fixture really permits the original attack.
    await c.query(
      'SET LOCAL ROLE da_api; SELECT public.review_escalate(); RESET ROLE',
    );
    expect(
      (await c.query("SELECT rolsuper FROM pg_roles WHERE rolname='da_api'"))
        .rows[0].rolsuper,
    ).toBe(true);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
  const checked = await admin.connect();
  try {
    await checked.query('BEGIN');
    await checked.query(
      `CREATE FUNCTION public.review_escalate() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN ALTER ROLE da_api SUPERUSER; END $$; GRANT EXECUTE ON FUNCTION public.review_escalate() TO da_api`,
    );
    await expect(
      checked.query(
        sqlScript(path.resolve('deploy'), 'postgres-bootstrap.sql'),
      ),
    ).rejects.toMatchObject({ code: 'P0001' });
  } finally {
    await checked.query('ROLLBACK');
    checked.release();
  }
  expect(
    (
      await api.query(
        'SELECT rolsuper FROM pg_roles WHERE rolname=current_user',
      )
    ).rows[0].rolsuper,
  ).toBe(false);
  const owner = await admin.connect();
  try {
    await owner.query('BEGIN');
    await owner.query(
      'CREATE FUNCTION public.review_owned() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$; ALTER FUNCTION public.review_owned() OWNER TO da_api',
    );
    await expect(
      owner.query(sqlScript(path.resolve('deploy'), 'postgres-bootstrap.sql')),
    ).rejects.toMatchObject({ code: 'P0001' });
  } finally {
    await owner.query('ROLLBACK');
    owner.release();
  }
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

it('starts the real API with restricted roles after stripping a previously valid sandbox config, with no secret in config-preflight/startup logs', async () => {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw Error('Synthetic port unavailable');
  const port = address.port;
  await new Promise<void>((r) => server.close(() => r()));
  const original = {
    APP_ENV: 'test',
    DATABASE_URL: 'postgresql://legacy:synthetic@postgres/' + name,
    API_HOST: '127.0.0.1',
    API_PORT: String(port),
    SESSION_TTL_SECONDS: '1209600',
    WEB_ORIGIN: 'https://old.invalid',
    TRUSTED_WEB_ORIGINS: 'https://old.invalid',
    GOOGLE_CLIENT_ID: 'synthetic-client',
    GOOGLE_CLIENT_SECRET: 'synthetic-google',
    GOOGLE_REDIRECT_URI: 'https://old.invalid/auth/google/callback',
    TELEGRAM_CLIENT_ID: 'synthetic-client',
    TELEGRAM_CLIENT_SECRET: 'synthetic-telegram',
    TELEGRAM_REDIRECT_URI: 'https://old.invalid/auth/telegram/callback',
    S3_ENDPOINT: process.env.S3_ENDPOINT!,
    S3_REGION: 'us-east-1',
    S3_BUCKET: privateBucket,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID!,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY!,
    PAYMENT_PROVIDER: 'yookassa',
    PAYMENT_MODE: 'sandbox',
    YOOKASSA_SHOP_ID: '12345',
    YOOKASSA_SECRET_KEY: 'test_synthetic_disabled_provider',
    PAYMENT_RETURN_URL: 'https://old.invalid/payments/return',
    PAYMENT_CREATOR_SHARE_BPS: '5000',
  };
  expect(loadPaymentConfig(original)?.PAYMENT_MODE).toBe('sandbox');
  const text = renderEnvironment(
    'api',
    Object.entries(original)
      .map(([k, v]) => `${k}='${v}'`)
      .join('\n') + '\n',
    { database: name, domains: { web: 'web.invalid', api: 'api.invalid' } },
  );
  const generated = Object.fromEntries(
    text
      .trim()
      .split('\n')
      .map((line) => {
        const i = line.indexOf('=');
        return [line.slice(0, i), line.slice(i + 2, -1)];
      }),
  );
  const u = new URL(generated.DATABASE_URL!);
  u.hostname = new URL(base).hostname;
  u.port = new URL(base).port;
  u.password = passwords[0]!;
  generated.DATABASE_URL = u.href;
  expect(loadApiStartupConfig(undefined, generated).paymentConfig).toBeNull();
  expect(generated.DISABLE_NEW_PAYMENTS).toBe('true');
  const env = { ...process.env, ...generated };
  for (const key of Object.keys(env))
    if (/^(PAYMENT_|YOOKASSA_)/.test(key)) delete env[key];
  const check = spawnSync(
    'pnpm',
    ['exec', 'tsx', 'apps/api/src/main.ts', '--check-config'],
    { env, encoding: 'utf8', timeout: 15000 },
  );
  expect(check.status, 'Real startup config preflight must succeed').toBe(0);
  expect(check.stdout.trim()).toBe('API_STARTUP_CONFIG_VALID');
  expect(
    (check.stdout + check.stderr).includes(original.YOOKASSA_SECRET_KEY),
  ).toBe(false);
  const child = spawn('pnpm', ['exec', 'tsx', 'apps/api/src/main.ts'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (v) => {
    logs += String(v);
  });
  child.stderr.on('data', (v) => {
    logs += String(v);
  });
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/health/ready`, {
          signal: AbortSignal.timeout(200),
        });
        if (r.status === 200) {
          ready = true;
          break;
        }
      } catch {
        /* bounded local startup */
      }
      if (child.exitCode !== null) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(ready, 'Real restricted API should become ready').toBe(true);
    const auth = await fetch(`http://127.0.0.1:${port}/auth/google/start`, {
      redirect: 'manual',
    });
    expect(auth.status).toBe(302);
    const payment = await fetch(`http://127.0.0.1:${port}/payments/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect([404, 503]).toContain(payment.status);
  } finally {
    child.kill('SIGTERM');
    await new Promise<void>((r) => {
      if (child.exitCode !== null) return r();
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      child.once('close', () => {
        clearTimeout(timer);
        r();
      });
    });
  }
  expect(logs.includes(original.YOOKASSA_SECRET_KEY)).toBe(false);
}, 30000);
it('refuses an existing runtime role granted to another login before changing credentials or ownership', async () => {
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query('CREATE ROLE destka_untrusted_role NOLOGIN');
    await c.query('GRANT da_api TO destka_untrusted_role');
    await expect(
      c.query(sqlScript(path.resolve('deploy'), 'postgres-bootstrap.sql')),
    ).rejects.toMatchObject({ code: 'P0001' });
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
});

it('verifies the real database dump and actual private bytes with the off-VM restore command; source remains unchanged', async () => {
  const { backupPrivateFiles, S3Client } =
    await import('../../packages/integrations/src/file-backup');
  const running = spawnSync('docker', ['ps', '--format', '{{.ID}}'], {
    encoding: 'utf8',
  })
    .stdout.trim()
    .split(/\s+/)
    .filter(Boolean);
  const containers = JSON.parse(
    spawnSync('docker', ['inspect', ...running], { encoding: 'utf8' }).stdout,
  ) as {
    Id: string;
    Image: string;
    NetworkSettings: { Ports: Record<string, { HostPort: string }[] | null> };
  }[];
  const sources = containers.filter((c) =>
    c.NetworkSettings.Ports['5432/tcp']?.some(
      (p) => p.HostPort === (new URL(base).port || '5432'),
    ),
  );
  expect(sources).toHaveLength(1);
  const source = sources[0]!.Id,
    image = sources[0]!.Image;
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
      checkpointId: 'a'.repeat(64),
      manifestHash: 'b'.repeat(64),
      fence: {
        epoch: 'synthetic',
        hba: 'c'.repeat(64),
        clients: 0,
        migratorLogin: false,
      },
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
