import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import {
  oauthRequestsPerMinute,
  registerOAuthRequestLimits,
} from './request-limits';

it('bounds concurrent OAuth requests before authentication/provider work, including query and HEAD variants', async () => {
  let instant = 0;
  const app = Fastify();
  registerOAuthRequestLimits(app, () => instant);
  const authenticate = vi.fn();
  app.addHook('preHandler', async () => {
    authenticate();
  });
  for (const provider of ['google', 'telegram', 'yandex', 'vk-id']) {
    for (const operation of ['start', 'callback']) {
      app.get(`/auth/${provider}/${operation}`, async () => ({ ok: true }));
    }
  }
  app.get('/health/live', async () => ({ status: 'ok' }));
  try {
    const burst = await Promise.all(
      Array.from({ length: oauthRequestsPerMinute }, (_, i) =>
        app.inject({
          method: i % 2 ? 'HEAD' : 'GET',
          url: `/auth/google/start?returnTo=${i}`,
          headers: { cookie: 'da_session=synthetic' },
        }),
      ),
    );
    expect(burst.every((r) => r.statusCode === 200)).toBe(true);
    expect(authenticate).toHaveBeenCalledTimes(oauthRequestsPerMinute);
    const refused = await app.inject('/auth/google/start?returnTo=different');
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toEqual({ error: { code: 'AUTH_RATE_LIMITED' } });
    expect(refused.headers['retry-after']).toBe('60');
    expect(refused.headers['cache-control']).toBe('no-store');
    expect(authenticate).toHaveBeenCalledTimes(oauthRequestsPerMinute);
    expect(
      (await app.inject({ method: 'HEAD', url: '/auth/google/start' }))
        .statusCode,
    ).toBe(429);
    for (const path of [
      '/auth/google/callback',
      '/auth/telegram/start',
      '/auth/yandex/start',
      '/auth/vk-id/start',
      '/health/live',
    ]) {
      expect((await app.inject(path)).statusCode).toBe(200);
    }
    instant = 59_500;
    expect(
      (await app.inject('/auth/google/start')).headers['retry-after'],
    ).toBe('1');
    instant = 60_000;
    expect((await app.inject('/auth/google/start')).statusCode).toBe(200);
  } finally {
    await app.close();
  }
});
