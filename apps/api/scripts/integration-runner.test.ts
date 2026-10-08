import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const databaseUrl =
  'postgresql://test:local_only@localhost:5433/autograph_test';
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(extension = 'mjs') {
  const directory = mkdtempSync(join(tmpdir(), 'integration runner & space '));
  directories.push(directory);
  const runner = join(directory, 'run-integration.mjs');
  const launcher = join(directory, `package manager & space.${extension}`);
  const log = join(directory, 'calls.jsonl');
  copyFileSync(
    new URL('../../../scripts/run-integration.mjs', import.meta.url),
    runner,
  );
  // Real child processes record arguments and environment without touching a DB.
  writeFileSync(
    launcher,
    `const fs = ${extension === 'cjs' ? "require('node:fs')" : "await import('node:fs')"};
const migration = process.argv.includes('db:migrate');
fs.appendFileSync(process.env.RUNNER_LOG, JSON.stringify({
  args: process.argv.slice(2),
  cwd: process.cwd(),
  databaseUrl: process.env.DATABASE_URL,
  testDatabaseUrl: process.env.TEST_DATABASE_URL,
  marker: process.env.RUNNER_MARKER,
}) + '\\n');
process.stdout.write(migration ? 'migration output\\n' : 'suite output\\n');
process.stderr.write(migration ? 'migration stderr\\n' : 'suite stderr\\n');
if (process.env.RUNNER_SIGNAL === 'true') process.kill(process.pid, 'SIGTERM');
process.exit(Number(migration ? process.env.MIGRATION_EXIT : process.env.SUITE_EXIT) || 0);
`,
  );

  function run(overrides: NodeJS.ProcessEnv = {}) {
    // Vitest workers may uppercase inherited Windows environment keys. Avoid
    // passing two case variants: Node keeps only the first sorted variant.
    const inherited = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => key.toLowerCase() !== 'npm_execpath',
      ),
    );
    const env = {
      ...inherited,
      TEST_DATABASE_URL: databaseUrl,
      DATABASE_URL: 'postgresql://dev:local_only@localhost:5432/autograph',
      npm_execpath: launcher,
      RUNNER_LOG: log,
      RUNNER_MARKER: 'forwarded & literal',
      MIGRATION_EXIT: '0',
      SUITE_EXIT: '0',
      RUNNER_SIGNAL: 'false',
      ...overrides,
    };
    // undefined must remove the inherited variable on both Windows and Linux.
    for (const key of Object.keys(env)) {
      if (env[key] === undefined) delete env[key];
    }
    const result = spawnSync(process.execPath, [runner], {
      cwd: directory,
      env,
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    const calls = existsSync(log)
      ? readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : [];
    return { ...result, calls };
  }
  return { directory, run };
}

describe('integration runner', () => {
  it.each(['mjs', 'cjs', 'js'])(
    'runs a %s launcher with literal paths and inherited output',
    (extension) => {
      const { directory, run } = fixture(extension);
      const result = run();
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).toBe('migration output\nsuite output\n');
      expect(result.stderr).toBe('migration stderr\nsuite stderr\n');
      expect(result.calls).toEqual([
        {
          args: ['--filter', '@digital-autograph/db', 'db:migrate'],
          cwd: directory,
          databaseUrl,
          testDatabaseUrl: databaseUrl,
          marker: 'forwarded & literal',
        },
        {
          args: [
            'exec',
            'vitest',
            'run',
            '--config',
            'vitest.integration.config.ts',
          ],
          cwd: directory,
          databaseUrl: 'postgresql://dev:local_only@localhost:5432/autograph',
          testDatabaseUrl: databaseUrl,
          marker: 'forwarded & literal',
        },
      ]);
    },
  );

  it.each([
    undefined,
    '',
    'not a URL',
    'postgresql://test:local_only@localhost:5433/autograph',
    'postgresql://test:local_only@localhost:5433/autograph_test_other',
  ])('rejects invalid test database %s before launching anything', (url) => {
    const result = fixture().run({ TEST_DATABASE_URL: url });
    expect(result.status).not.toBe(0);
    expect(result.calls).toEqual([]);
  });

  it('explains how to invoke the runner when pnpm context is missing', () => {
    const result = fixture().run({ npm_execpath: undefined });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('pnpm test:integration');
    expect(result.calls).toEqual([]);
  });

  it('stops before Vitest and preserves a migration failure exit code', () => {
    const result = fixture().run({ MIGRATION_EXIT: '42' });
    expect(result.status).toBe(42);
    expect(result.calls).toHaveLength(1);
  });

  it('preserves a failing integration suite exit code', () => {
    const result = fixture().run({ SUITE_EXIT: '43' });
    expect(result.status).toBe(43);
    expect(result.calls).toHaveLength(2);
  });

  it('fails when the launcher cannot be spawned', () => {
    const { directory, run } = fixture();
    const result = run({ npm_execpath: join(directory, 'missing executable') });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('ENOENT');
    expect(result.calls).toEqual([]);
  });

  it('fails when a child terminates by signal and stops before Vitest', () => {
    const result = fixture().run({ RUNNER_SIGNAL: 'true' });
    expect(result.status).not.toBe(0);
    expect(result.calls).toHaveLength(1);
  });
});
