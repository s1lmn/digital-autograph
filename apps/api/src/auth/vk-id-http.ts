import type { AppEnvironment } from '@digital-autograph/config';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { setSessionCookie, type AuthHttpConfig } from './http';
import {
  vkIdLoginAttemptTtlSeconds,
  type VkIdLoginService,
} from './vk-id-login';
import { normalizeReturnPath } from './return-path';

export type VkIdHttpConfig = {
  appEnvironment: AppEnvironment;
  webOrigin: string;
  redirectUri: string;
};
function cookieName(config: VkIdHttpConfig, kind: 'oauth' | 'pkce') {
  return `${config.appEnvironment === 'production' ? '__Host-' : ''}da_vk_id_${kind}`;
}
function cookieOptions(config: VkIdHttpConfig) {
  return {
    httpOnly: true,
    secure: ['staging', 'production'].includes(config.appEnvironment),
    sameSite: 'lax' as const,
    path: '/',
  };
}
function clearCookies(reply: FastifyReply, config: VkIdHttpConfig) {
  for (const kind of ['oauth', 'pkce'] as const)
    reply.clearCookie(cookieName(config, kind), cookieOptions(config));
}
export function registerVkIdRoutes(
  app: FastifyInstance,
  login: VkIdLoginService,
  auth: AuthHttpConfig,
  config: VkIdHttpConfig,
) {
  const host = new URL(config.redirectUri).host;
  const failure = (code: string) =>
    `${config.webOrigin}/auth/error?code=${code}`;
  app.get('/auth/vk-id/start', async (request, reply) => {
    reply
      .header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer');
    if (request.headers.host !== host)
      return reply
        .code(400)
        .send({ error: { code: 'INVALID_CALLBACK_ORIGIN' } });
    if (request.authContext?.kind === 'authenticated')
      return reply.code(409).send({ error: { code: 'ALREADY_AUTHENTICATED' } });
    try {
      const query = request.query as Record<string, unknown>;
      const started = await login.start(normalizeReturnPath(query.returnTo));
      const options = {
        ...cookieOptions(config),
        maxAge: vkIdLoginAttemptTtlSeconds,
      };
      reply.setCookie(
        cookieName(config, 'oauth'),
        started.browserBinding,
        options,
      );
      reply.setCookie(
        cookieName(config, 'pkce'),
        started.codeVerifier,
        options,
      );
      return reply.redirect(started.authorizationUrl);
    } catch {
      return reply.redirect(failure('VK_AUTH_FAILED'));
    }
  });
  app.get('/auth/vk-id/callback', async (request, reply) => {
    reply
      .header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer');
    const browserBinding = request.cookies[cookieName(config, 'oauth')];
    const codeVerifier = request.cookies[cookieName(config, 'pkce')];
    clearCookies(reply, config);
    const query = new URL(request.url, config.redirectUri).searchParams;
    if (
      request.headers.host !== host ||
      ['state', 'code', 'error', 'device_id'].some(
        (key) => query.getAll(key).length > 1,
      )
    )
      return reply.redirect(failure('VK_AUTH_FAILED'));
    const outcome = await login.finish({
      state: query.get('state') ?? undefined,
      browserBinding,
      codeVerifier,
      code: query.get('code') ?? undefined,
      deviceId: query.get('device_id') ?? undefined,
      providerError: query.get('error') ?? undefined,
      alreadyAuthenticated: request.authContext?.kind === 'authenticated',
    });
    if (outcome.kind === 'success') {
      setSessionCookie(reply, outcome.token, auth);
      return reply.redirect(
        `${config.webOrigin}${normalizeReturnPath(outcome.returnPath)}`,
      );
    }
    return reply.redirect(
      failure(
        outcome.kind === 'cancelled'
          ? 'VK_AUTH_CANCELLED'
          : outcome.kind === 'alreadyAuthenticated'
            ? 'ALREADY_AUTHENTICATED'
            : 'VK_AUTH_FAILED',
      ),
    );
  });
}
