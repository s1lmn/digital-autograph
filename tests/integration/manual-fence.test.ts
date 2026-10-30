// Real Docker/PostgreSQL fence with synthetic data. Image loading/API config have
// separate tests; only those unrelated operations are stubbed in this harness.
import { spawnSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  rmSync,
  realpathSync,
  openSync,
  closeSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase } from '../../packages/db/src/index';
import { deploy, fingerprint, sha256 } from '../../deploy/manual-deploy.mjs';

const prefix = 'destka-fence-' + randomBytes(6).toString('hex');
const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix))),
  root = path.join(dir, 'tools'),
  state = path.join(dir, 'state');
mkdirSync(root);
mkdirSync(state);
const toolFiles = [
  'manual-deploy.mjs',
  'manual-env.mjs',
  'deploy-on-vm.sh',
  'Caddyfile',
  'Caddyfile.destka',
  'postgres-bootstrap.sql',
  'postgres-preflight.sql',
  'postgres-normalize.sql',
  'postgres-runtime.sql',
  'database-state.sql',
  'compose.yaml',
  'compose.staging.yaml',
  'compose.manual.yaml',
];
for (const file of toolFiles)
  copyFileSync(path.join('deploy', file), path.join(root, file));
const image = spawnSync(
  'docker',
  ['image', 'inspect', '--format', '{{.Id}}', 'postgres:17-alpine'],
  { encoding: 'utf8' },
).stdout.trim();
const sourceSha = 'a'.repeat(40),
  password = 'synthetic-legacy-local-only-' + randomBytes(16).toString('hex');
let port: string, pgId: string;
const writers: string[] = [];
const model = {
  services: {
    api: {
      environment: {
        DATABASE_URL:
          'postgresql://da_api:' + 'a'.repeat(64) + '@postgres/autograph_test',
        S3_ACCESS_KEY_ID: 'synthetic',
        S3_SECRET_ACCESS_KEY: 'synthetic',
        S3_BUCKET: 'synthetic',
        S3_ENDPOINT: 'https://storage.invalid',
        DISABLE_NEW_PAYMENTS: 'true',
        DISABLE_FREE_CLAIMS: 'false',
      },
    },
    worker: {
      environment: {
        DATABASE_URL:
          'postgresql://da_worker:' +
          'b'.repeat(64) +
          '@postgres/autograph_test',
        S3_ACCESS_KEY_ID: 'synthetic',
        S3_SECRET_ACCESS_KEY: 'synthetic',
      },
    },
    migration: {
      environment: {
        DATABASE_URL:
          'postgresql://da_migrator:' +
          'c'.repeat(64) +
          '@postgres/autograph_test',
      },
    },
    postgres: {
      environment: {
        POSTGRES_USER: 'legacy_operator',
        POSTGRES_PASSWORD: password,
        POSTGRES_DB: 'autograph_test',
      },
    },
  },
};
function docker(
  args: string[],
  options?: { input?: string; stdoutFile?: string; timeout?: number },
) {
  const fd = options?.stdoutFile
    ? openSync(options.stdoutFile, 'wx', 0o600)
    : undefined;
  try {
    const result = spawnSync('docker', args, {
      input: options?.input,
      encoding: 'utf8',
      timeout: options?.timeout ?? 60000,
      maxBuffer: 16 * 1024 * 1024,
      ...(fd === undefined
        ? {}
        : { stdio: ['pipe', fd, 'pipe'] as ['pipe', number, 'pipe'] }),
    });
    if (result.status !== 0 || result.error)
      throw Error('Synthetic Docker fence command failed');
    return result.stdout ?? '';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
const sql = (query: string) =>
  docker(
    [
      'exec',
      '-i',
      pgId,
      'psql',
      '-X',
      '-qAt',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'legacy_operator',
      '-d',
      'autograph_test',
    ],
    { input: query },
  );
let ddlCalls = 0;
const run = (
  program: string,
  args: string[],
  options?: { input?: string; stdoutFile?: string; timeout?: number },
) => {
  if (program === 'df') return 'Available\n40000000000';
  if (program !== 'docker') throw Error('Unexpected synthetic harness command');
  if (args[0] !== 'compose') {
    if (args[0] === 'load') return '';
    if (args[0] === 'image')
      return JSON.stringify([
        {
          Id: image,
          Os: 'linux',
          Architecture: 'amd64',
          Config: {
            Labels: { 'org.opencontainers.image.revision': sourceSha },
          },
        },
      ]);
    if (args[0] === 'run' && args.includes('--check-config'))
      return 'API_STARTUP_CONFIG_VALID';
    return docker(args, options);
  }
  const rest = args.slice(
    args.indexOf(path.join(root, 'compose.manual.yaml')) + 1,
  );
  if (rest[0] === 'config') return JSON.stringify(model);
  if (rest[0] === 'ps') return rest[1] === '-aq' ? writers.join('\n') : pgId;
  if (rest[0] === 'stop') {
    docker(['stop', '--time', '5', ...writers]);
    return '';
  }
  if (rest[0] === 'restart') {
    docker(['restart', '--time', '5', pgId]);
    port = docker(['port', pgId, '5432/tcp']).trim().split(':').at(-1)!;
    return '';
  }
  if (rest[0] === 'exec') {
    if (rest.some((a) => a.includes('pg_dump')))
      return docker(
        [
          'exec',
          pgId,
          'pg_dump',
          '-U',
          'legacy_operator',
          '-d',
          'autograph_test',
          '--format=custom',
        ],
        options,
      );
    if (options?.input?.includes('Direct/default ACL normalization'))
      ddlCalls++;
    return sql(options?.input ?? '');
  }
  if (rest[0] === 'run') {
    const url = new URL(model.services.migration.environment.DATABASE_URL);
    url.hostname = '127.0.0.1';
    url.port = port;
    const result = spawnSync(
      process.execPath,
      [path.resolve('packages/db/node_modules/drizzle-kit/bin.cjs'), 'migrate'],
      {
        cwd: path.resolve('packages/db'),
        env: { ...process.env, APP_ENV: 'test', DATABASE_URL: url.href },
        encoding: 'utf8',
        timeout: 30000,
      },
    );
    if (result.status !== 0)
      throw Error('Synthetic restricted migration failed');
    return '';
  }
  throw Error('Unexpected synthetic Compose operation');
};
const options = {
  root,
  state,
  ownerUid: process.getuid!(),
  run,
  wait: () => {},
};
const baselineMigrations = JSON.parse(
  readFileSync('packages/db/drizzle/meta/_journal.json', 'utf8'),
).entries.map((e: { tag: string; when: number }) => ({
  hash: sha256(readFileSync(`packages/db/drizzle/${e.tag}.sql`)),
  created_at: e.when,
}));
function operation() {
  const m = {
    schemaVersion: 1,
    sourceSha,
    operation: 'operation-' + randomBytes(8).toString('hex'),
    database: 'autograph_test',
    project: 'digital-autograph',
    environment: 'staging',
    instanceId: 'a'.repeat(20),
    runtimeServiceAccountId: 'b'.repeat(20),
    runtimeSecretIds: ['c'.repeat(20), 'd'.repeat(20)],
    domains: { web: 'web.invalid', api: 'api.invalid' },
    caddyConfig: 'Caddyfile',
    publicDomainApproved: false,
    drainSeconds: 330,
    infrastructure: { postgres: image, caddy: image },
    images: Object.fromEntries(
      ['api', 'worker', 'web', 'migration'].map((app) => [
        app,
        {
          id: image,
          archive: app + '.tar',
          archiveSha256: sha256('synthetic'),
        },
      ]),
    ),
    migrations: baselineMigrations,
    toolBundleSha256: fingerprint(
      Object.fromEntries(
        toolFiles.map((f) => [f, sha256(readFileSync(path.join(root, f)))]),
      ),
    ),
  };
  const incoming = path.join(root, 'incoming', m.operation);
  mkdirSync(path.join(incoming, 'env'), { recursive: true });
  for (const app of ['api', 'worker', 'web', 'migration'])
    writeFileSync(path.join(incoming, app + '.tar'), 'synthetic', {
      mode: 0o600,
    });
  for (const app of ['api', 'worker', 'migration'])
    writeFileSync(path.join(incoming, 'env', app + '.env'), 'synthetic', {
      mode: 0o600,
    });
  writeFileSync(
    path.join(incoming, 'metadata-proof.json'),
    JSON.stringify({
      instanceId: m.instanceId,
      runtimeServiceAccountId: m.runtimeServiceAccountId,
      observedAt: new Date().toISOString(),
      effectiveAuthorityReviewedBy: 'synthetic-only',
      metadata_options: {
        aws_v1_http_token: 'DISABLED',
        aws_v2_http_token: 'DISABLED',
        gce_http_token: 'DISABLED',
      },
      lockbox: m.runtimeSecretIds.map((secretId) => ({
        secretId,
        bindings: [],
      })),
    }),
    { mode: 0o600 },
  );
  return m;
}
function recovery(m: ReturnType<typeof operation>) {
  const op = path.join(state, m.operation),
    record = JSON.parse(readFileSync(path.join(op, 'state.json'), 'utf8'));
  writeFileSync(path.join(op, 'files-manifest.json'), 'synthetic', {
    mode: 0o600,
  });
  writeFileSync(
    path.join(op, 'recovery-proof.json'),
    JSON.stringify({
      checkpointId: record.checkpointId,
      manifestHash: record.manifestHash,
      fenceHash: fingerprint(record.fence),
      databaseArchiveSha256: record.databaseArchiveSha256,
      baselineHash: record.baselineHash,
      filesManifestSha256: sha256('synthetic'),
      sourceBucket: 'synthetic',
      sourceEndpoint: 'https://storage.invalid',
      offVm: true,
      databaseRestorePassed: true,
      filesRestorePassed: true,
      reviewedBy: 'synthetic-fence-test-not-real-recovery',
    }),
    { mode: 0o600 },
  );
}
beforeAll(async () => {
  pgId = docker([
    'run',
    '-d',
    '--name',
    prefix + '-pg',
    '-p',
    '127.0.0.1::5432',
    '-e',
    'POSTGRES_USER=legacy_operator',
    '-e',
    'POSTGRES_DB=autograph_test',
    '-e',
    'POSTGRES_PASSWORD=' + password,
    image,
  ]).trim();
  docker([
    'exec',
    pgId,
    'sh',
    '-c',
    'until pg_isready -h127.0.0.1 >/dev/null 2>&1; do sleep 1; done',
  ]);
  port = docker(['port', pgId, '5432/tcp']).trim().split(':').at(-1)!;
  for (const app of ['api', 'worker'])
    writers.push(
      docker([
        'run',
        '-d',
        '--name',
        prefix + '-' + app,
        '--network',
        'none',
        image,
        'sleep',
        '600',
      ]).trim(),
    );
  const migrationDir = path.join(dir, 'baseline');
  mkdirSync(path.join(migrationDir, 'meta'), { recursive: true });
  const journal = JSON.parse(
    readFileSync('packages/db/drizzle/meta/_journal.json', 'utf8'),
  );
  journal.entries = journal.entries.slice(0, 17);
  writeFileSync(
    path.join(migrationDir, 'meta/_journal.json'),
    JSON.stringify(journal),
  );
  for (const e of journal.entries)
    copyFileSync(
      'packages/db/drizzle/' + e.tag + '.sql',
      path.join(migrationDir, e.tag + '.sql'),
    );
  const { createDatabase, migrate } =
    await import('../../packages/db/src/index');
  const db = createDatabase(
    `postgresql://legacy_operator:${password}@127.0.0.1:${port}/autograph_test`,
  );
  try {
    await migrate(db.db, { migrationsFolder: migrationDir });
    await db.pool.query(
      "INSERT INTO users(id,status) VALUES ('00000000-0000-4000-8000-000000000001','active')",
    );
  } finally {
    await db.close();
  }
}, 60000);
afterAll(() => {
  for (const id of [...writers, pgId].filter(Boolean))
    docker(['rm', '-f', '-v', id]);
  rmSync(dir, { recursive: true, force: true });
});
it('restart fence terminates an authenticated idle legacy login and persistently rejects its credentials over real TCP', async () => {
  const oldDatabase = createDatabase(
    `postgresql://legacy_operator:${password}@127.0.0.1:${port}/autograph_test`,
  );
  const old = await oldDatabase.pool.connect();
  old.on('error', () => {});
  try {
    const m = operation();
    expect(deploy(m, 'prepare', options).stage).toBe('BACKUP_REQUIRED');
    await expect(old.query('SELECT 1')).rejects.toBeDefined();
    const reconnect = createDatabase(
      `postgresql://legacy_operator:${password}@127.0.0.1:${port}/autograph_test`,
    );
    try {
      await expect(reconnect.checkConnection()).rejects.toMatchObject({
        code: '28000',
      });
    } finally {
      await reconnect.close();
    }
    recovery(m);
    expect(deploy(m, 'apply', options).stage).toBe('MIGRATED');
  } finally {
    old.release(true);
    await oldDatabase.close();
  }
}, 60000);
it.each([0, 1])(
  'resumed legacy container %i invalidates the real checkpoint before ownership/DDL',
  (index) => {
    const m = operation();
    deploy(m, 'prepare', options);
    recovery(m);
    const before = ddlCalls;
    docker(['start', writers[index]!]);
    docker(['stop', '--time', '5', writers[index]!]);
    expect(() => deploy(m, 'apply', options)).toThrow('invalidated');
    expect(ddlCalls).toBe(before);
  },
  60000,
);
it('same-count UPDATE changes the real row digest and invalidates checkpoint before DDL', () => {
  const m = operation();
  deploy(m, 'prepare', options);
  recovery(m);
  const before = ddlCalls;
  sql(
    "UPDATE users SET status=CASE WHEN status='active' THEN 'disabled'::user_status ELSE 'active'::user_status END",
  );
  expect(() => deploy(m, 'apply', options)).toThrow('invalidated');
  expect(ddlCalls).toBe(before);
  expect(() => deploy(m, 'apply', options)).toThrow('partial');
}, 60000);
it('an idle local DB session invalidates the checkpoint even without data changes', async () => {
  const m = operation();
  deploy(m, 'prepare', options);
  recovery(m);
  const before = ddlCalls;
  const idle = spawn(
    'docker',
    [
      'exec',
      '-i',
      pgId,
      'psql',
      '-X',
      '-qAt',
      '-U',
      'legacy_operator',
      '-d',
      'autograph_test',
    ],
    { stdio: ['pipe', 'ignore', 'ignore'] },
  );
  try {
    for (let i = 0; i < 30; i++) {
      if (
        sql(
          "SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND backend_type='client backend'",
        ).trim() === '1'
      )
        break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(() => deploy(m, 'apply', options)).toThrow('invalidated');
    expect(ddlCalls).toBe(before);
  } finally {
    idle.stdin.end();
    await new Promise<void>((r) => idle.on('close', () => r()));
  }
}, 60000);
