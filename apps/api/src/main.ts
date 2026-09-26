import { loadApiConfig } from '@digital-autograph/config';
import { createDatabase } from '@digital-autograph/db';
import { buildApi } from './app';

async function main(): Promise<void> {
  const config = loadApiConfig();
  const database = createDatabase(config.DATABASE_URL);
  const app = buildApi(database);
  let closing = false;

  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    try {
      await app.close();
      await database.close();
    } catch (error) {
      app.log.error(error, 'API shutdown failed');
      process.exitCode = 1;
    }
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());

  try {
    await app.listen({ host: config.API_HOST, port: config.API_PORT });
  } catch (error) {
    app.log.error(error, 'API startup failed');
    await shutdown();
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
