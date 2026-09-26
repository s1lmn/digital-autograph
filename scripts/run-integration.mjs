import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/autograph_test') {
  throw new Error(
    'TEST_DATABASE_URL must point to the isolated autograph_test database',
  );
}

function run(args, env = process.env) {
  const result = spawnSync('pnpm', args, { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(['--filter', '@digital-autograph/db', 'db:migrate'], {
  ...process.env,
  DATABASE_URL: databaseUrl,
});
run(['exec', 'vitest', 'run', '--config', 'vitest.integration.config.ts']);
