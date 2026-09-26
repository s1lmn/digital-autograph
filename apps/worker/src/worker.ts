import type { Database } from '@digital-autograph/db';
import type { EventEmitter } from 'node:events';

type DatabaseConnection = Pick<Database, 'checkConnection' | 'close'>;
type Signals = Pick<EventEmitter, 'once' | 'removeListener'>;

export async function runWorker(
  database: DatabaseConnection,
  signals: Signals = process,
  onReady: () => void = () => {},
): Promise<void> {
  try {
    await database.checkConnection();
    await new Promise<void>((resolve) => {
      const stop = () => {
        signals.removeListener('SIGINT', stop);
        signals.removeListener('SIGTERM', stop);
        resolve();
      };
      signals.once('SIGINT', stop);
      signals.once('SIGTERM', stop);
      onReady();
    });
  } finally {
    await database.close();
  }
}
