import type { FastifyInstance } from 'fastify';
import { ApiResponseMetrics } from '@digital-autograph/observability';

export const apiMetricsIntervalMs = 60_000;

export function registerApiMetrics(app: FastifyInstance): void {
  const metrics = new ApiResponseMetrics();
  let timer: ReturnType<typeof setInterval> | undefined;
  const flush = () => {
    const snapshot = metrics.drain();
    if (!snapshot) return;
    try {
      app.log.info(snapshot, 'API response metrics');
    } catch {
      // A failed diagnostics sink must not reject application responses or close.
      // The drained window is lost; do not retry an ambiguous log write.
    }
  };
  app.addHook('onRoute', (route) => {
    const routeMethods = Array.isArray(route.method)
      ? route.method
      : [route.method];
    for (const method of routeMethods) metrics.registerRoute(method, route.url);
  });
  app.addHook('onResponse', async (request, reply) => {
    metrics.record(
      request.method,
      request.is404 ? undefined : request.routeOptions.url,
      reply.statusCode,
      reply.elapsedTime,
    );
  });
  app.addHook('onReady', async () => {
    metrics.drain(); // Exclude bootstrap time from the first sampling window.
    timer = setInterval(flush, apiMetricsIntervalMs);
    timer.unref();
  });
  app.addHook('onClose', async () => {
    clearInterval(timer);
    flush();
  });
}
