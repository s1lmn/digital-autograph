import {
  liveHealthResponse,
  readyHealthResponse,
} from '@digital-autograph/contracts';
import type { Database } from '@digital-autograph/db';
import Fastify from 'fastify';

type DatabaseProbe = Pick<Database, 'checkConnection'>;

export function buildApi(database: DatabaseProbe) {
  const app = Fastify({ logger: true });

  app.get('/health/live', async () =>
    liveHealthResponse.parse({ status: 'ok' }),
  );

  app.get('/health/ready', async (_request, reply) => {
    try {
      await database.checkConnection();
      return readyHealthResponse.parse({ status: 'ready' });
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  return app;
}
