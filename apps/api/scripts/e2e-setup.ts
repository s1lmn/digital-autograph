import { spawnSync } from 'node:child_process';
import { createDatabase } from '@digital-autograph/db';
import { createPrivateS3Storage } from '@digital-autograph/integrations';
import { isolatedE2EEnvironment } from '../../../e2e/environment';

async function waitForService(name: string, operation: () => Promise<unknown>) {
  for (let attempt = 1; ; attempt++) {
    try {
      await operation();
      return;
    } catch (error) {
      if (attempt >= 30)
        throw new Error(`${name} did not become ready`, { cause: error });
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
const config = isolatedE2EEnvironment();
const database = createDatabase(config.databaseUrl);
try {
  await waitForService('E2E PostgreSQL', () => database.checkConnection());
  // Reset the journal too: retaining it would skip migrations after public is dropped.
  await database.pool.query(
    'DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public',
  );
} finally {
  await database.close();
}
const migration = spawnSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['--filter', '@digital-autograph/db', 'db:migrate'],
  { env: process.env, stdio: 'inherit', shell: process.platform === 'win32' },
);
if (migration.error) throw migration.error;
if (migration.status !== 0) process.exit(migration.status ?? 1);
const storage = createPrivateS3Storage(config.storage);
try {
  await waitForService('E2E MinIO', () => storage.bootstrapLocalBucket());
} finally {
  storage.close();
}
console.log(
  'Migrated the isolated E2E database; each test owns its fixtures and cleanup.',
);
