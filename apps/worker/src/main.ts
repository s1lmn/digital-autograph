import { loadWorkerConfig } from '@digital-autograph/config';
import { createDatabase } from '@digital-autograph/db';
import { runWorker } from './worker';

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const database = createDatabase(config.DATABASE_URL);
  await runWorker(database, process, () => {
    console.info(`Worker ready (${config.APP_ENV}); waiting for future jobs`);
  });
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
