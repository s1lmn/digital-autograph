import { setTimeout as delay } from 'node:timers/promises';
import type { EventEmitter } from 'node:events';
import type {
  Database,
  AutographProcessingRepository,
  ClaimedAutographJob,
} from '@digital-autograph/db';
import {
  PrivateObjectTooLargeError,
  type PrivateOriginalStorage,
} from '@digital-autograph/autographs';
import {
  ImageProcessingError,
  imagePolicy,
  processAutographImage,
} from './image-processing';

type DatabaseConnection = Pick<Database, 'checkConnection' | 'close'>;
type Signals = Pick<EventEmitter, 'once' | 'removeListener'>;

export type WorkerOperations = {
  repository: AutographProcessingRepository;
  storage: PrivateOriginalStorage;
  leaseSeconds: number;
  pollIntervalMs: number;
  cleanupGraceSeconds: number;
};

function cleanedKey(job: ClaimedAutographJob): string {
  return `autographs/${job.autographId}/cleaned/${job.id}.png`;
}

export async function processOneAutographJob(
  operations: WorkerOperations,
): Promise<boolean> {
  const job = await operations.repository.claim(operations.leaseSeconds);
  if (!job) return false;
  const key = cleanedKey(job);
  let putAttempted = false;
  let uploaded = false;
  try {
    const original = await operations.storage.getPrivateObject(
      job.originalKey,
      imagePolicy.maxInputBytes,
    );
    const processed = await processAutographImage(
      original,
      job.source,
      job.expectedContentType,
    );
    putAttempted = true;
    await operations.storage.putPrivateObject(key, processed.bytes);
    uploaded = true;
    await operations.repository.succeed(
      job,
      {
        key,
        sizeBytes: processed.bytes.length,
        width: processed.width,
        height: processed.height,
      },
      operations.leaseSeconds,
    );
  } catch (error) {
    // A failed PUT may leave a partial object. A DB error after a successful PUT
    // keeps the deterministic private key so a retry can adopt/overwrite it.
    if (putAttempted && !uploaded) {
      try {
        await operations.repository.cleanupPartial(
          job,
          operations.leaseSeconds,
          () => operations.storage.deleteObject(key),
        );
      } catch {
        console.warn('Partial cleaned object cleanup failed', {
          jobId: job.id,
        });
      }
    }
    const permanent =
      error instanceof ImageProcessingError ||
      error instanceof PrivateObjectTooLargeError;
    const code =
      error instanceof ImageProcessingError
        ? error.code
        : error instanceof PrivateObjectTooLargeError
          ? 'IMAGE_TOO_LARGE'
          : uploaded
            ? 'PROCESSING_FAILURE'
            : 'STORAGE_FAILURE';
    try {
      await operations.repository.fail(
        job,
        code,
        permanent,
        operations.leaseSeconds,
      );
    } catch {
      console.error('Autograph job failure could not be recorded', {
        jobId: job.id,
      });
    }
    console.warn('Autograph processing attempt failed', {
      jobId: job.id,
      code,
    });
  }
  return true;
}

export async function runWorker(
  database: DatabaseConnection,
  signals: Signals = process,
  onReady: () => void = () => {},
  operations?: WorkerOperations,
): Promise<void> {
  let stopping = false;
  let wake: (() => void) | undefined;
  const stopped = new Promise<void>((resolve) => {
    wake = resolve;
  });
  const stop = () => {
    stopping = true;
    wake?.();
  };
  signals.once('SIGINT', stop);
  signals.once('SIGTERM', stop);
  try {
    await database.checkConnection();
    onReady();
    while (!stopping) {
      if (operations) {
        try {
          await processOneAutographJob(operations);
          if (!stopping)
            await operations.repository.cleanupAbandoned(
              operations.cleanupGraceSeconds,
              (key) => operations.storage.deleteObject(key),
            );
        } catch {
          console.error('Worker polling cycle failed');
        }
      }
      if (!stopping)
        await Promise.race([
          delay(operations?.pollIntervalMs ?? 1000),
          stopped,
        ]);
    }
  } finally {
    signals.removeListener('SIGINT', stop);
    signals.removeListener('SIGTERM', stop);
    await database.close();
  }
}
