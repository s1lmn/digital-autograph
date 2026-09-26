import type {
  AuthenticatedSession,
  SessionService,
} from '@digital-autograph/auth';
import type { AppEnvironment } from '@digital-autograph/config';
import type { FastifyReply, FastifyRequest } from 'fastify';

export type AuthContext =
  | { kind: 'anonymous' }
  | { kind: 'authenticated'; session: AuthenticatedSession };

declare module 'fastify' {
  interface FastifyRequest {
    authContext: AuthContext | null;
  }
}

export type AuthHttpConfig = {
  appEnvironment: AppEnvironment;
  sessionTtlSeconds: number;
  trustedWebOrigins: readonly string[];
};

export type HttpSessionService = Pick<
  SessionService,
  'validateSession' | 'revokeSession' | 'revokeAllUserSessions'
>;

export function sessionCookieName(config: AuthHttpConfig): string {
  return config.appEnvironment === 'production'
    ? '__Host-da_session'
    : 'da_session';
}

function cookieOptions(config: AuthHttpConfig) {
  return {
    httpOnly: true,
    secure: ['production', 'staging'].includes(config.appEnvironment),
    sameSite: 'lax' as const,
    path: '/',
  };
}

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  config: AuthHttpConfig,
): void {
  reply.setCookie(sessionCookieName(config), token, {
    ...cookieOptions(config),
    maxAge: config.sessionTtlSeconds,
  });
}

export function clearSessionCookie(
  reply: FastifyReply,
  config: AuthHttpConfig,
): void {
  reply.clearCookie(sessionCookieName(config), cookieOptions(config));
}

export function invalidOrigin(
  request: FastifyRequest,
  config: AuthHttpConfig,
): boolean {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method))
    return false;
  if (!request.cookies[sessionCookieName(config)]) return false;
  const origin = request.headers.origin;
  return !origin || !config.trustedWebOrigins.includes(origin);
}

export async function requireAuthenticatedUser(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  if (request.authContext?.kind === 'authenticated') return;
  return reply.code(401).send({ error: { code: 'UNAUTHENTICATED' } });
}

export function authenticatedSession(
  request: FastifyRequest,
): AuthenticatedSession {
  const context = request.authContext;
  if (context?.kind !== 'authenticated') {
    throw new Error('Authenticated route is missing its guard');
  }
  return context.session;
}

export function registerAuthRoutes(
  app: import('fastify').FastifyInstance,
  sessions: HttpSessionService,
  config: AuthHttpConfig,
): void {
  app.get(
    '/auth/me',
    { preHandler: requireAuthenticatedUser },
    async (request) => {
      const { user } = authenticatedSession(request);
      return { user };
    },
  );

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[sessionCookieName(config)];
    if (token) await sessions.revokeSession(token);
    clearSessionCookie(reply, config);
    return reply.code(204).send();
  });

  app.post(
    '/auth/logout-all',
    { preHandler: requireAuthenticatedUser },
    async (request, reply) => {
      const { user } = authenticatedSession(request);
      await sessions.revokeAllUserSessions(user.id);
      clearSessionCookie(reply, config);
      return reply.code(204).send();
    },
  );
}
