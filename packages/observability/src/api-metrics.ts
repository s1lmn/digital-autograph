export const apiLatencyBoundsMs = [
  5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
] as const;
export const apiMetricSeriesLimit = 128;
const methods = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
]);
const maxDurationMs = 86_400_000;

function counters() {
  return {
    responses: 0,
    // Positions represent 1xx, 2xx, 3xx, 4xx, 5xx and invalid/other status.
    statusCounts: [0, 0, 0, 0, 0, 0],
    timedResponses: 0,
    invalidDurations: 0,
    durationSumMs: 0,
    durationMaxMs: 0,
    latencyLeCounts: apiLatencyBoundsMs.map(() => 0),
  };
}
type Counters = ReturnType<typeof counters>;
type Labels = { method: string; route: string };

function increment(stats: Counters, status: number, durationMs: number) {
  stats.responses++;
  const statusIndex =
    Number.isInteger(status) && status >= 100 && status <= 599
      ? Math.floor(status / 100) - 1
      : 5;
  stats.statusCounts[statusIndex]!++;
  if (
    !Number.isFinite(durationMs) ||
    durationMs < 0 ||
    durationMs > maxDurationMs
  ) {
    stats.invalidDurations++;
    return;
  }
  stats.timedResponses++;
  stats.durationSumMs += durationMs;
  stats.durationMaxMs = Math.max(stats.durationMaxMs, durationMs);
  apiLatencyBoundsMs.forEach((bound, index) => {
    if (durationMs <= bound) stats.latencyLeCounts[index]!++;
  });
}

/** Route labels may be registered only from trusted server route definitions. */
export class ApiResponseMetrics {
  private readonly registered = new Map<string, Labels>();
  private series = new Map<string, Labels & Counters>();
  private total = counters();
  private startedAt: number;

  constructor(private readonly now: () => number = () => performance.now()) {
    this.startedAt = now();
  }

  registerRoute(method: string, route: string): void {
    if (
      !methods.has(method) ||
      !route.startsWith('/') ||
      route.length > 256 ||
      /[?#\r\n]/.test(route)
    )
      return;
    const key = `${method} ${route}`;
    if (this.registered.size < apiMetricSeriesLimit)
      this.registered.set(key, { method, route });
  }

  record(
    method: string,
    route: string | undefined,
    status: number,
    durationMs: number,
  ): void {
    increment(this.total, status, durationMs);
    const normalizedMethod = methods.has(method) ? method : 'OTHER';
    const labels = this.registered.get(`${normalizedMethod} ${route}`) ?? {
      method: normalizedMethod,
      route: '<unmatched>',
    };
    let key = `${labels.method} ${labels.route}`;
    let stats = this.series.get(key);
    if (!stats) {
      // Reserve the last row for all excess series. Global totals never drop.
      if (this.series.size >= apiMetricSeriesLimit - 1) {
        key = 'OTHER <overflow>';
        stats = this.series.get(key);
      }
      if (!stats) {
        stats = {
          ...(key === 'OTHER <overflow>'
            ? { method: 'OTHER', route: '<overflow>' }
            : labels),
          ...counters(),
        };
        this.series.set(key, stats);
      }
    }
    increment(stats, status, durationMs);
  }

  drain() {
    const endedAt = this.now();
    const elapsed = endedAt - this.startedAt;
    const snapshot = {
      event: 'API_METRICS' as const,
      windowSeconds: Number.isFinite(elapsed) ? Math.max(0, elapsed / 1000) : 0,
      latencyLeMs: [...apiLatencyBoundsMs],
      total: this.total,
      routes: [...this.series.values()],
    };
    this.startedAt = endedAt;
    this.total = counters();
    this.series = new Map();
    return snapshot.total.responses > 0 ? snapshot : undefined;
  }
}
