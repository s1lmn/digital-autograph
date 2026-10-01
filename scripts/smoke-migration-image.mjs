import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import console from 'node:console';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// Keep container names below the 63-character DNS label limit.
const name = `da-migrate-${randomUUID()}`;
const database = `${name}-postgres`;
const image = `${name}:test`;
const journal = JSON.parse(
  readFileSync(
    new URL('../packages/db/drizzle/meta/_journal.json', import.meta.url),
  ),
);
const expectedTables = [
  ...readFileSync(
    new URL('../packages/db/src/schema.ts', import.meta.url),
    'utf8',
  ).matchAll(/pgTable\(\s*'([^']+)'/g),
]
  .map((match) => match[1])
  .sort();

function docker(args, options = {}) {
  const { combinedOutput = false, ...spawnOptions } = options;
  const result = spawnSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
    ...spawnOptions,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, (result.stdout ?? '') + (result.stderr ?? ''));
  return combinedOutput ? result.stdout + result.stderr : result.stdout;
}

function sql(query) {
  return docker([
    'exec',
    database,
    'psql',
    '-U',
    'migration_test',
    '-d',
    'migration_test',
    '-At',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    query,
  ]).trim();
}

function schemaFingerprint() {
  const dump = docker([
    'exec',
    database,
    'pg_dump',
    '-U',
    'migration_test',
    '-d',
    'migration_test',
    '--schema-only',
    '--no-owner',
    '--no-privileges',
  ]);
  // Recent pg_dump versions generate a fresh restriction nonce on every dump.
  return createHash('sha256')
    .update(
      dump
        .split('\n')
        .filter((line) => !/^\\(?:un)?restrict /.test(line))
        .join('\n'),
    )
    .digest('hex');
}

try {
  docker(
    [
      'buildx',
      'bake',
      '--file',
      'deploy/docker-bake.hcl',
      '--set',
      `migration.tags=${image}`,
      '--set',
      'migration.output=type=docker',
      'migration',
    ],
    {
      env: {
        ...process.env,
        YC_REGISTRY_ID: 'local-test-only',
        IMAGE_TAG: 'local-test-only',
        GITHUB_ACTIONS: 'false',
      },
      stdio: 'inherit',
      timeout: 1_800_000,
    },
  );
  const [config] = JSON.parse(docker(['image', 'inspect', image]));
  assert.equal(config.Architecture, 'amd64');
  assert.equal(config.Config.WorkingDir, '/workspace/packages/db');
  assert.deepEqual(config.Config.Cmd, [
    './node_modules/.bin/drizzle-kit',
    'migrate',
  ]);
  assert.deepEqual(config.Config.Entrypoint, ['docker-entrypoint.sh']);
  console.log(`Migration image: linux/amd64, ${config.Size} bytes`);
  docker([
    'run',
    '--rm',
    '--read-only',
    '--entrypoint',
    'node',
    image,
    '-e',
    `const fs = require('fs');
     console.log('Node:', process.version);
     for (const path of ['node_modules/.bin/drizzle-kit', 'node_modules/drizzle-kit/bin.cjs',
       'drizzle.config.ts', 'src/schema.ts', 'drizzle/meta/_journal.json']) {
       if (!fs.existsSync(path)) throw new Error('Missing ' + path);
       console.log(path + ': PASS (' + fs.realpathSync(path) + ')');
     }`,
  ])
    .split('\n')
    .filter(Boolean)
    .forEach((line) => console.log(line));

  docker(['network', 'create', '--internal', name]);
  docker([
    'run',
    '-d',
    '--name',
    database,
    '--network',
    name,
    '-e',
    'POSTGRES_USER=migration_test',
    '-e',
    'POSTGRES_PASSWORD=synthetic_local_only',
    '-e',
    'POSTGRES_DB=migration_test',
    'postgres:17-alpine',
  ]);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const probe = spawnSync(
      'docker',
      [
        'exec',
        database,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'migration_test',
        '-d',
        'migration_test',
      ],
      { stdio: 'ignore', timeout: 10_000 },
    );
    if (probe.status === 0) {
      ready = true;
      break;
    }
    await delay(1000);
  }
  assert.ok(ready, 'Isolated PostgreSQL did not become ready');
  assert.equal(
    sql("SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"),
    '0',
  );

  let firstJournal;
  let firstSchema;
  for (const run of [1, 2]) {
    const container = `${name}-run-${run}`;
    docker([
      'create',
      '--name',
      container,
      '--network',
      name,
      '--read-only',
      '--tmpfs',
      '/tmp',
      '-e',
      'APP_ENV=staging',
      '-e',
      `DATABASE_URL=postgresql://migration_test:synthetic_local_only@${database}:5432/migration_test`,
      image,
    ]);
    const [created] = JSON.parse(docker(['inspect', container]));
    assert.equal(created.Config.Tty, false);
    assert.equal(created.HostConfig.ReadonlyRootfs, true);
    const output = docker(['start', '-a', container], { combinedOutput: true });
    assert.doesNotMatch(
      output,
      /ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY|pnpm\s+install/i,
    );
    assert.match(output, /drizzle\.config\.ts/);
    assert.match(output, /migrations applied successfully/);
    const [finished] = JSON.parse(docker(['inspect', container]));
    assert.equal(finished.State.ExitCode, 0);
    const rows = sql(
      'SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id',
    );
    assert.equal(rows.split('\n').length, journal.entries.length);
    const tables = sql(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    ).split('\n');
    assert.deepEqual(tables, expectedTables);
    const schema = schemaFingerprint();
    if (run === 1) {
      firstJournal = rows;
      firstSchema = schema;
    } else {
      assert.equal(rows, firstJournal);
      assert.equal(schema, firstSchema);
    }
    console.log(
      `Migration run ${run}: PASS; no TTY; read-only image; config loaded; ${journal.entries.length} journal entries; ${tables.length} public tables; no implicit install`,
    );
  }
  console.log(
    'Migration image runtime smoke PASS: clean database and idempotent second run',
  );
} finally {
  // Unique names ensure cleanup cannot affect an existing development database.
  for (const container of [`${name}-run-1`, `${name}-run-2`, database]) {
    spawnSync('docker', ['rm', '-fv', container], { stdio: 'ignore' });
  }
  spawnSync('docker', ['network', 'rm', name], { stdio: 'ignore' });
  spawnSync('docker', ['image', 'rm', image], { stdio: 'ignore' });
}
