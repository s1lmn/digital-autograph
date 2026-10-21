import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiLoggerOptions, registerSafeApiErrors } from './logging';
import { apiMetricsIntervalMs, registerApiMetrics } from './metrics';

function fixture() {
  const lines: Record<string, unknown>[] = [];
  const app = Fastify({
    logger: apiLoggerOptions({ write: (line) => lines.push(JSON.parse(line)) }),
  });
  registerSafeApiErrors(app);
  registerApiMetrics(app);
  return {
    app,
    snapshots: () => lines.filter((line) => line.event === 'API_METRICS'),
  };
}

describe('Fastify aggregate metrics', () => {
  afterEach(() => vi.useRealTimers());

  it('records real completed responses once and omits sensitive request data', async () => {
    const { app, snapshots } = fixture();
    const canary = 'synthetic-private-value';
    app.post('/orders/:id', async (request, reply) => {
      expect(request.body).toEqual({ privateValue: canary });
      return reply.code(201).send({ privateValue: canary });
    });
    app.get('/handled', async (_request, reply) =>
      reply.code(429).send({ error: { code: 'LIMIT' } }),
    );
    app.get('/failure', async () => {
      throw new Error(canary);
    });
    await app.register(
      async (child) => {
        child.get('/nested/:id', async () => ({ ok: true }));
      },
      { prefix: '/group' },
    );
    try {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/orders/${canary}?token=${canary}`,
            headers: {
              authorization: canary,
              cookie: `session=${canary}`,
              'x-request-id': canary,
            },
            payload: { privateValue: canary },
          })
        ).statusCode,
      ).toBe(201);
      expect((await app.inject('/handled')).statusCode).toBe(429);
      const failed = await app.inject('/failure');
      expect(failed.statusCode).toBe(500);
      expect(failed.json()).toEqual({ error: { code: 'INTERNAL_ERROR' } });
      expect((await app.inject(`/group/nested/${canary}`)).statusCode).toBe(
        200,
      );
      for (let i = 0; i < 20; i++)
        expect(
          (await app.inject(`/unknown-${canary}-${i}?code=${canary}`))
            .statusCode,
        ).toBe(404);
      expect(snapshots()).toHaveLength(0);
    } finally {
      await app.close();
    }
    const snapshot = snapshots()[0]! as {
      total: {
        responses: number;
        statusCounts: number[];
        timedResponses: number;
      };
      routes: Array<{ method: string; route: string; responses: number }>;
    };
    expect(snapshots()).toHaveLength(1);
    expect(snapshot.total.responses).toBe(24);
    expect(snapshot.total.statusCounts).toEqual([0, 2, 0, 21, 1, 0]);
    expect(snapshot.total.timedResponses).toBe(24);
    expect(snapshot.routes.map((row) => row.route)).toEqual([
      '/orders/:id',
      '/handled',
      '/failure',
      '/group/nested/:id',
      '<unmatched>',
    ]);
    expect(JSON.stringify(snapshot)).not.toContain(canary);
    expect(snapshot).not.toHaveProperty('reqId');
    expect(snapshot).not.toHaveProperty('req');
    expect(snapshot).not.toHaveProperty('err');
  });

  it('flushes disjoint windows, skips idle windows and clears the timer on close', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { app, snapshots } = fixture();
    app.get('/ok', async () => ({ ok: true }));
    try {
      await app.ready();
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(apiMetricsIntervalMs);
      expect(snapshots()).toHaveLength(0);
      await app.inject('/ok');
      vi.advanceTimersByTime(apiMetricsIntervalMs);
      expect(snapshots()).toHaveLength(1);
      await app.inject('/ok');
    } finally {
      await app.close();
    }
    expect(snapshots()).toHaveLength(2);
    for (const row of snapshots())
      expect(row.total).toMatchObject({ responses: 1 });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(apiMetricsIntervalMs * 2);
    expect(snapshots()).toHaveLength(2);
  });

  it('does not disrupt requests or graceful close when the metric sink throws', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { app, snapshots } = fixture();
    app.get('/ok', async () => ({ ok: true }));
    const info = vi.spyOn(app.log, 'info').mockImplementation(() => {
      throw new Error('sink canary');
    });
    try {
      expect((await app.inject('/ok')).statusCode).toBe(200);
      vi.advanceTimersByTime(apiMetricsIntervalMs);
      expect(info).toHaveBeenCalledOnce();
      expect((await app.inject('/ok')).statusCode).toBe(200);
    } finally {
      await app.close();
    }
    expect(info).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    expect(snapshots()).toHaveLength(0);
  });
});
