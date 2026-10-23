import type { FastifyInstance } from 'fastify';

// Eight fixed buckets: no attacker-keyed map, IP address or account tracking.
// These are per-process overload guards, not a distributed anti-fraud policy.
// Four start routes admit at most 800 attempts/minute per API process, below
// the worker's 1000-row/minute cleanup batch in the single-instance baseline.
export const oauthRequestsPerMinute = 200;
const windowMs = 60_000;

export function registerOAuthRequestLimits(
  app: FastifyInstance,
  now: () => number = () => performance.now(),
): void {
  const buckets = new Map<string, { startedAt: number; used: number }>(
    ['google', 'telegram', 'yandex', 'vk-id'].flatMap((provider) =>
      ['start', 'callback'].map(
        (operation) =>
          [
            `/auth/${provider}/${operation}`,
            { startedAt: now(), used: 0 },
          ] as const,
      ),
    ),
  );
  app.addHook('onRequest', async (request, reply) => {
    // Fastify can expose HEAD for a GET handler; it must not bypass the budget.
    if (request.method !== 'GET' && request.method !== 'HEAD') return;
    const route = request.routeOptions.url;
    if (!route) return;
    const bucket = buckets.get(route);
    if (!bucket) return;
    const instant = now();
    if (instant - bucket.startedAt >= windowMs) {
      bucket.startedAt = instant;
      bucket.used = 0;
    }
    if (bucket.used >= oauthRequestsPerMinute) {
      return reply
        .header('Cache-Control', 'no-store')
        .header(
          'Retry-After',
          Math.max(
            1,
            Math.ceil((windowMs - instant + bucket.startedAt) / 1000),
          ),
        )
        .code(429)
        .send({ error: { code: 'AUTH_RATE_LIMITED' } });
    }
    bucket.used++;
  });
}
