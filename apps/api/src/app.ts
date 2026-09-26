import {
  liveHealthResponse,
  readyHealthResponse,
} from '@digital-autograph/contracts';
import type { Database } from '@digital-autograph/db';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import {
  invalidOrigin,
  registerAuthRoutes,
  sessionCookieName,
  type AuthHttpConfig,
  type HttpSessionService,
} from './auth/http';

type DatabaseProbe = Pick<Database, 'checkConnection'>;

export function buildApi(
  database: DatabaseProbe,
  sessions: HttpSessionService,
  authConfig: AuthHttpConfig,
) {
  const app = Fastify({
    logger: {
      redact: {
        paths: ['req.headers.cookie', 'req.headers.authorization'],
        censor: '[REDACTED]',
      },
    },
  });

  app.register(cookie);
  app.register(cors, {
    origin: [...authConfig.trustedWebOrigins],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type'],
    strictPreflight: true,
  });
  app.decorateRequest('authContext', null);
  app.addHook('preHandler', async (request, reply) => {
    request.authContext = { kind: 'anonymous' };
    if (invalidOrigin(request, authConfig)) {
      return reply.code(403).send({ error: { code: 'INVALID_ORIGIN' } });
    }
    if (request.url.startsWith('/health/')) return;
    const token = request.cookies[sessionCookieName(authConfig)];
    if (!token) return;
    const session = await sessions.validateSession(token);
    if (session) request.authContext = { kind: 'authenticated', session };
  });

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

  registerAuthRoutes(app, sessions, authConfig);

  return app;
}
