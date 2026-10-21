import { describe, expect, it } from 'vitest';
import { ApiResponseMetrics, apiMetricSeriesLimit } from './api-metrics';

describe('bounded response metrics', () => {
  it('counts status classes and inclusive cumulative latency bounds', () => {
    let now = 1000;
    const metrics = new ApiResponseMetrics(() => now);
    metrics.registerRoute('GET', '/walls/:id');
    for (const [status, duration] of [
      [200, 5],
      [201, 10],
      [302, 11],
      [401, 50],
      [503, 10001],
      [0, 0],
    ])
      metrics.record('GET', '/walls/:id', status!, duration!);
    now = 61_000;
    const snapshot = metrics.drain()!;
    expect(snapshot.windowSeconds).toBe(60);
    expect(snapshot.total).toMatchObject({
      responses: 6,
      statusCounts: [0, 2, 1, 1, 1, 1],
      timedResponses: 6,
      invalidDurations: 0,
      durationSumMs: 10077,
      durationMaxMs: 10001,
      latencyLeCounts: [2, 3, 4, 5, 5, 5, 5, 5, 5, 5, 5],
    });
    expect(snapshot.routes).toEqual([
      { method: 'GET', route: '/walls/:id', ...snapshot.total },
    ]);
    expect(metrics.drain()).toBeUndefined();
    metrics.record('GET', '/walls/:id', 200, 2);
    now += 500;
    const next = metrics.drain()!;
    expect(next.windowSeconds).toBe(0.5);
    expect(next.total.responses).toBe(1);
    // Draining never mutates a snapshot that has already been passed to a sink.
    expect(snapshot.total.responses).toBe(6);
    expect(snapshot.routes[0]!.responses).toBe(6);
  });

  it('keeps status counts when a duration is invalid without biasing latency', () => {
    const metrics = new ApiResponseMetrics();
    for (const duration of [NaN, Infinity, -1, 86_400_001])
      metrics.record('GET', undefined, 500, duration);
    const total = metrics.drain()!.total;
    expect(total).toMatchObject({
      responses: 4,
      statusCounts: [0, 0, 0, 0, 4, 0],
      timedResponses: 0,
      invalidDurations: 4,
      durationSumMs: 0,
      durationMaxMs: 0,
    });
    expect(total.latencyLeCounts.every((count) => count === 0)).toBe(true);
    expect(JSON.stringify(total)).not.toMatch(/NaN|Infinity|null/);
  });

  it('collapses thousands of caller-controlled paths and methods to fixed labels', () => {
    const metrics = new ApiResponseMetrics();
    metrics.registerRoute('GET', '/walls/:id');
    for (let i = 0; i < 1000; i++) {
      metrics.record('GET', `/private-person-${i}?secret=canary`, 404, 1);
      metrics.record(`PRIVATE-METHOD-${i}`, '/walls/:id', 404, 1);
    }
    const snapshot = metrics.drain()!;
    expect(snapshot.total.responses).toBe(2000);
    expect(
      snapshot.routes.map(({ method, route }) => ({ method, route })),
    ).toEqual([
      { method: 'GET', route: '<unmatched>' },
      { method: 'OTHER', route: '<unmatched>' },
    ]);
    expect(JSON.stringify(snapshot)).not.toMatch(
      /private-person|secret|canary|PRIVATE-METHOD/,
    );
  });

  it('bounds registration and output while preserving totals for overflow traffic', () => {
    const metrics = new ApiResponseMetrics();
    for (let i = 0; i < 1000; i++) {
      metrics.registerRoute('GET', `/route-${i}`);
      metrics.record('GET', `/route-${i}`, 200, 1);
    }
    const snapshot = metrics.drain()!;
    expect(snapshot.total.responses).toBe(1000);
    expect(snapshot.routes).toHaveLength(apiMetricSeriesLimit);
    expect(
      snapshot.routes.find((row) => row.route === '<overflow>')!.responses,
    ).toBe(1000 - (apiMetricSeriesLimit - 1));
    expect(snapshot.routes.reduce((sum, row) => sum + row.responses, 0)).toBe(
      1000,
    );
    expect(JSON.stringify(snapshot).length).toBeLessThan(65_536);
  });

  it('rejects query-bearing, oversized and invalid server label definitions', () => {
    const metrics = new ApiResponseMetrics();
    for (const route of [
      '/route?secret=canary',
      '/route#canary',
      '/route\ncanary',
      'canary',
      '/' + 'x'.repeat(256),
    ]) {
      metrics.registerRoute('GET', route);
      metrics.record('GET', route, 400, 1);
    }
    expect(metrics.drain()!.routes).toEqual([
      expect.objectContaining({
        method: 'GET',
        route: '<unmatched>',
        responses: 5,
      }),
    ]);
  });
});
