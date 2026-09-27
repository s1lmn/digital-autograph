import type { AppEnvironment } from '@digital-autograph/config';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { setSessionCookie, type AuthHttpConfig } from './http';
import {
  googleLoginAttemptTtlSeconds,
  type GoogleLoginService,
} from './google-login';
import { normalizeReturnPath } from './return-path';

export type GoogleHttpConfig = {
  appEnvironment: AppEnvironment;
  webOrigin: string;
};

function oauthCookieName(config: GoogleHttpConfig): string {
  return config.appEnvironment === 'production'
    ? '__Host-da_google_oauth'
    : 'da_google_oauth';
}

function oauthCookieOptions(config: GoogleHttpConfig) {
  return {
    httpOnly: true,
    secure: ['staging', 'production'].includes(config.appEnvironment),
    sameSite: 'lax' as const,
    path: '/',
  };
}

function clearOAuthCookie(reply: FastifyReply, config: GoogleHttpConfig): void {
  reply.clearCookie(oauthCookieName(config), oauthCookieOptions(config));
}

function failureUrl(config: GoogleHttpConfig, code: string): string {
  return `${config.webOrigin}/auth/error?code=${code}`;
}

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function registerGoogleRoutes(
  app: FastifyInstance,
  login: GoogleLoginService,
  authConfig: AuthHttpConfig,
  googleConfig: GoogleHttpConfig,
): void {
  app.get('/auth/google/start', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    if (request.authContext?.kind === 'authenticated') {
      return reply.code(409).send({ error: { code: 'ALREADY_AUTHENTICATED' } });
    }
    const query = request.query as Record<string, unknown>;
    try {
      const started = await login.start(normalizeReturnPath(query.returnTo));
      reply.setCookie(oauthCookieName(googleConfig), started.browserBinding, {
        ...oauthCookieOptions(googleConfig),
        maxAge: googleLoginAttemptTtlSeconds,
      });
      return reply.redirect(started.authorizationUrl);
    } catch {
      return reply.redirect(failureUrl(googleConfig, 'GOOGLE_AUTH_FAILED'));
    }
  });

  app.get('/auth/google/callback', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    const query = request.query as Record<string, unknown>;
    const binding = request.cookies[oauthCookieName(googleConfig)];
    clearOAuthCookie(reply, googleConfig);
    const outcome = await login.finish({
      state: stringParam(query.state),
      browserBinding: binding,
      code: stringParam(query.code),
      providerError: stringParam(query.error),
      alreadyAuthenticated: request.authContext?.kind === 'authenticated',
    });
    if (outcome.kind === 'success') {
      setSessionCookie(reply, outcome.token, authConfig);
      return reply.redirect(
        `${googleConfig.webOrigin}${normalizeReturnPath(outcome.returnPath)}`,
      );
    }
    const errorCode =
      outcome.kind === 'cancelled'
        ? 'GOOGLE_AUTH_CANCELLED'
        : outcome.kind === 'alreadyAuthenticated'
          ? 'ALREADY_AUTHENTICATED'
          : 'GOOGLE_AUTH_FAILED';
    return reply.redirect(failureUrl(googleConfig, errorCode));
  });
}
