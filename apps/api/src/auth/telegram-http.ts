import type { AppEnvironment } from '@digital-autograph/config';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { setSessionCookie, type AuthHttpConfig } from './http';
import {
  telegramLoginAttemptTtlSeconds,
  type TelegramLoginService,
} from './telegram-login';
import { normalizeReturnPath } from './return-path';

export type TelegramHttpConfig = {
  appEnvironment: AppEnvironment;
  webOrigin: string;
};

function temporaryCookieName(
  config: TelegramHttpConfig,
  kind: 'oauth' | 'pkce',
): string {
  const name = `da_telegram_${kind}`;
  return config.appEnvironment === 'production' ? `__Host-${name}` : name;
}

function temporaryCookieOptions(config: TelegramHttpConfig) {
  return {
    httpOnly: true,
    secure: ['staging', 'production'].includes(config.appEnvironment),
    sameSite: 'lax' as const,
    path: '/',
  };
}

function clearTemporaryCookies(
  reply: FastifyReply,
  config: TelegramHttpConfig,
): void {
  for (const kind of ['oauth', 'pkce'] as const) {
    reply.clearCookie(
      temporaryCookieName(config, kind),
      temporaryCookieOptions(config),
    );
  }
}

function failureUrl(config: TelegramHttpConfig, code: string): string {
  return `${config.webOrigin}/auth/error?code=${code}`;
}

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function registerTelegramRoutes(
  app: FastifyInstance,
  login: TelegramLoginService,
  authConfig: AuthHttpConfig,
  telegramConfig: TelegramHttpConfig,
): void {
  app.get('/auth/telegram/start', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    if (request.authContext?.kind === 'authenticated') {
      return reply.code(409).send({ error: { code: 'ALREADY_AUTHENTICATED' } });
    }
    const query = request.query as Record<string, unknown>;
    try {
      const started = await login.start(normalizeReturnPath(query.returnTo));
      const cookieOptions = {
        ...temporaryCookieOptions(telegramConfig),
        maxAge: telegramLoginAttemptTtlSeconds,
      };
      reply.setCookie(
        temporaryCookieName(telegramConfig, 'oauth'),
        started.browserBinding,
        cookieOptions,
      );
      reply.setCookie(
        temporaryCookieName(telegramConfig, 'pkce'),
        started.pkceCookieValue,
        cookieOptions,
      );
      return reply.redirect(started.authorizationUrl);
    } catch {
      return reply.redirect(failureUrl(telegramConfig, 'TELEGRAM_AUTH_FAILED'));
    }
  });

  app.get('/auth/telegram/callback', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    const query = request.query as Record<string, unknown>;
    const browserBinding =
      request.cookies[temporaryCookieName(telegramConfig, 'oauth')];
    const pkceCookieValue =
      request.cookies[temporaryCookieName(telegramConfig, 'pkce')];
    clearTemporaryCookies(reply, telegramConfig);
    const outcome = await login.finish({
      state: stringParam(query.state),
      browserBinding,
      pkceCookieValue,
      code: stringParam(query.code),
      providerError: stringParam(query.error),
      alreadyAuthenticated: request.authContext?.kind === 'authenticated',
    });
    if (outcome.kind === 'success') {
      setSessionCookie(reply, outcome.token, authConfig);
      return reply.redirect(
        `${telegramConfig.webOrigin}${normalizeReturnPath(outcome.returnPath)}`,
      );
    }
    const errorCode =
      outcome.kind === 'cancelled'
        ? 'TELEGRAM_AUTH_CANCELLED'
        : outcome.kind === 'alreadyAuthenticated'
          ? 'ALREADY_AUTHENTICATED'
          : 'TELEGRAM_AUTH_FAILED';
    return reply.redirect(failureUrl(telegramConfig, errorCode));
  });
}
