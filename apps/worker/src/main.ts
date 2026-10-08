import { loadWorkerConfig } from '@digital-autograph/config';
import { runtimeFailureRecord } from '@digital-autograph/observability';
import {
  createDatabase,
  createPgAutographProcessingRepository,
} from '@digital-autograph/db';
import { createPrivateS3Storage } from '@digital-autograph/integrations/private-s3';
import { restrictWorkerImageLoaders } from './image-processing';
import { runWorker } from './worker';

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const database = createDatabase(config.DATABASE_URL);
  const storage = createPrivateS3Storage({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    bucket: config.S3_BUCKET,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
  });
  let workerStarted = false;
  try {
    if (['local', 'test', 'development'].includes(config.APP_ENV))
      await storage.bootstrapLocalBucket();
    restrictWorkerImageLoaders();
    workerStarted = true;
    await runWorker(
      database,
      process,
      () => {
        console.info(
          `Worker ready (${config.APP_ENV}); polling private autograph jobs`,
        );
      },
      {
        repository: createPgAutographProcessingRepository(database.pool),
        storage,
        leaseSeconds: config.WORKER_LEASE_SECONDS,
        pollIntervalMs: config.WORKER_POLL_INTERVAL_MS,
        cleanupGraceSeconds: config.UPLOAD_CLEANUP_GRACE_SECONDS,
      },
    );
  } finally {
    if (!workerStarted) await database.close();
    storage.close();
  }
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify(runtimeFailureRecord('worker', error)));
  process.exitCode = 1;
});
