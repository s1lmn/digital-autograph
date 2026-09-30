import type { SessionService } from '@digital-autograph/auth';
import type { FastifyInstance } from 'fastify';
import { setSessionCookie, type AuthHttpConfig } from './http';
import { normalizeReturnPath } from './return-path';

type TestSessionService = Pick<SessionService, 'createSession'>;

export function registerTestAuthRoutes(
  app: FastifyInstance,
  sessions: TestSessionService,
  authConfig: AuthHttpConfig,
  userId: string,
  webOrigin: string,
): void {
  if (
    process.env.ENABLE_TEST_AUTH_SEAM !== 'true' ||
    authConfig.appEnvironment !== 'test' ||
    process.env.NODE_ENV === 'production' ||
    !authConfig.trustedWebOrigins.includes(webOrigin) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      userId,
    )
  ) {
    throw new Error(
      'Test auth seam requires ENABLE_TEST_AUTH_SEAM=true in a test environment',
    );
  }

  app.get('/auth/test/start', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const returnTo = normalizeReturnPath(query.returnTo);
    return reply.redirect(
      `/auth/test/callback?returnTo=${encodeURIComponent(returnTo)}`,
    );
  });

  app.get('/auth/test/callback', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const issued = await sessions.createSession(userId);
    setSessionCookie(reply, issued.token, authConfig);
    return reply.redirect(`${webOrigin}${normalizeReturnPath(query.returnTo)}`);
  });
}
