import { Agent, request } from 'node:http';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import process from 'node:process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const loadLimits = {
  requests: 100_000,
  concurrency: 100,
  timeoutMs: 30_000,
  responseBytes: 1_048_576,
} as const;
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
type Config = {
  target: string;
  requests: number;
  concurrency: number;
  timeoutMs: number;
  responseBytes: number;
};
type Failure =
  'http' | 'network' | 'timeout' | 'bodyTooLarge' | 'invalidWall' | 'aborted';
type Attempt = { status: number; durationMs: number; failure?: Failure };

function integer(value: string, maximum: number): number {
  if (!/^[1-9]\d*$/.test(value)) throw new Error('INVALID_LOAD_ARGUMENT');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum)
    throw new Error('INVALID_LOAD_ARGUMENT');
  return parsed;
}

function targetUrl(target: string): URL {
  const url = new URL(target);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/walls\/[^/]+$/.test(url.pathname) ||
    !uuid.test(url.pathname.slice('/walls/'.length))
  )
    throw new Error('INVALID_LOAD_TARGET');
  return url;
}

export function parseLoadArgs(args: string[]): Config {
  const values = new Map<string, string>();
  const allowed = new Set([
    '--target',
    '--requests',
    '--concurrency',
    '--timeout-ms',
    '--response-bytes',
  ]);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!;
    const value = args[i + 1];
    if (!allowed.has(key) || values.has(key) || !value)
      throw new Error('INVALID_LOAD_ARGUMENT');
    values.set(key, value);
  }
  const target = values.get('--target');
  if (!target) throw new Error('INVALID_LOAD_TARGET');
  targetUrl(target);
  const config = {
    target,
    requests: integer(values.get('--requests') ?? '100', loadLimits.requests),
    concurrency: integer(
      values.get('--concurrency') ?? '5',
      loadLimits.concurrency,
    ),
    timeoutMs: integer(
      values.get('--timeout-ms') ?? '5000',
      loadLimits.timeoutMs,
    ),
    responseBytes: integer(
      values.get('--response-bytes') ?? '1048576',
      loadLimits.responseBytes,
    ),
  };
  if (config.concurrency > config.requests)
    throw new Error('INVALID_LOAD_ARGUMENT');
  return config;
}

export function latencySummary(samples: number[]) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (fraction: number) =>
    sorted[Math.ceil(fraction * sorted.length) - 1]!;
  return {
    samples: sorted.length,
    meanMs: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    maxMs: sorted[sorted.length - 1]!,
  };
}

function coherentWall(value: unknown, wallId: string): boolean {
  if (!value || typeof value !== 'object') return false;
  const wall = value as Record<string, unknown>;
  if (
    typeof wall.id !== 'string' ||
    wall.id.toLowerCase() !== wallId ||
    typeof wall.status !== 'string' ||
    !['scheduled', 'live', 'paused', 'ended'].includes(wall.status) ||
    !Number.isInteger(wall.slotCount) ||
    Number(wall.slotCount) < 1 ||
    Number(wall.slotCount) > 1000 ||
    !Array.isArray(wall.slots) ||
    wall.slots.length !== wall.slotCount
  )
    return false;
  const ids = new Set<string>();
  return wall.slots.every((value: unknown, index: number) => {
    if (!value || typeof value !== 'object') return false;
    const slot = value as Record<string, unknown>;
    if (
      typeof slot.id !== 'string' ||
      !uuid.test(slot.id) ||
      ids.has(slot.id.toLowerCase()) ||
      slot.position !== index ||
      typeof slot.occupied !== 'boolean'
    )
      return false;
    ids.add(slot.id.toLowerCase());
    return true;
  });
}

function readWall(
  url: URL,
  config: Config,
  agent: Agent,
  signal?: AbortSignal,
): Promise<Attempt> {
  return new Promise((settle) => {
    const started = performance.now();
    let settled = false;
    let status = 0;
    const finish = (failure?: Failure) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settle({
        status,
        durationMs: performance.now() - started,
        ...(failure ? { failure } : {}),
      });
    };
    const req = request(
      url,
      {
        method: 'GET',
        agent,
        signal,
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'identity',
          'Cache-Control': 'no-cache',
        },
      },
      (response) => {
        status = response.statusCode ?? 0;
        let bytes = 0;
        // One bounded buffer avoids unbounded per-chunk bookkeeping on trickle streams.
        const body =
          status === 200 ? Buffer.allocUnsafe(config.responseBytes) : undefined;
        response.on('data', (chunk: Buffer) => {
          if (settled) return;
          const offset = bytes;
          bytes += chunk.length;
          if (bytes > config.responseBytes) {
            finish('bodyTooLarge');
            req.destroy();
          } else body?.set(chunk, offset);
        });
        response.on('error', () =>
          finish(signal?.aborted ? 'aborted' : 'network'),
        );
        response.on('end', () => {
          if (status !== 200) return finish('http');
          try {
            const value: unknown = JSON.parse(
              body!.subarray(0, bytes).toString('utf8'),
            );
            finish(
              coherentWall(
                value,
                url.pathname.slice('/walls/'.length).toLowerCase(),
              )
                ? undefined
                : 'invalidWall',
            );
          } catch {
            finish('invalidWall');
          }
        });
      },
    );
    req.on('error', () => finish(signal?.aborted ? 'aborted' : 'network'));
    // Whole-attempt deadline, not a socket-idle timeout that a slow stream can evade.
    const timer = setTimeout(() => {
      finish('timeout');
      req.destroy();
    }, config.timeoutMs);
    req.end();
  });
}

export async function runPublicWallLoad(config: Config, signal?: AbortSignal) {
  // Validate even direct callers before creating sockets or allocating workers.
  const checked = parseLoadArgs([
    '--target',
    config.target,
    '--requests',
    String(config.requests),
    '--concurrency',
    String(config.concurrency),
    '--timeout-ms',
    String(config.timeoutMs),
    '--response-bytes',
    String(config.responseBytes),
  ]);
  const url = targetUrl(checked.target);
  const agent = new Agent({
    keepAlive: true,
    maxSockets: checked.concurrency,
    maxTotalSockets: checked.concurrency,
  });
  const durations: number[] = [];
  const successfulDurations: number[] = [];
  const statusCounts = [0, 0, 0, 0, 0, 0]; // 1xx .. 5xx, no/invalid response
  const errors: Record<Failure, number> = {
    http: 0,
    network: 0,
    timeout: 0,
    bodyTooLarge: 0,
    invalidWall: 0,
    aborted: 0,
  };
  let next = 0;
  const started = performance.now();
  try {
    await Promise.all(
      Array.from({ length: checked.concurrency }, async () => {
        while (!signal?.aborted && next < checked.requests) {
          next++;
          const attempt = await readWall(url, checked, agent, signal);
          durations.push(attempt.durationMs);
          const index =
            attempt.status >= 100 && attempt.status <= 599
              ? Math.floor(attempt.status / 100) - 1
              : 5;
          statusCounts[index]!++;
          if (attempt.failure) errors[attempt.failure]++;
          else successfulDurations.push(attempt.durationMs);
        }
      }),
    );
  } finally {
    agent.destroy();
  }
  const durationSeconds = (performance.now() - started) / 1000;
  return {
    kind: 'local-public-wall-closed-loop-probe',
    targetOrigin: url.origin,
    routeTemplate: '/walls/:id',
    plannedRequests: checked.requests,
    completedRequests: durations.length,
    concurrency: checked.concurrency,
    timeoutMs: checked.timeoutMs,
    responseBytes: checked.responseBytes,
    interrupted: signal?.aborted ?? false,
    successes: successfulDurations.length,
    failures: durations.length - successfulDurations.length,
    durationSeconds,
    completedPerSecond:
      durationSeconds > 0 ? durations.length / durationSeconds : 0,
    statusCounts,
    errors,
    latencyMs: {
      allAttempts: latencySummary(durations),
      successfulReads: latencySummary(successfulDurations),
    },
  };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const report = await runPublicWallLoad(
      parseLoadArgs(process.argv.slice(2)),
      controller.signal,
    );
    console.log(JSON.stringify(report));
    process.exitCode = report.interrupted ? 130 : report.failures ? 1 : 0;
  } catch {
    console.error(
      'Public Wall load probe failed: check arguments and local configuration.',
    );
    process.exitCode = 2;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}
