import { createServer, type RequestListener, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  latencySummary,
  parseLoadArgs,
  runPublicWallLoad,
} from './public-wall-load';

const wallId = '00000000-0000-4000-8000-000000000001';
const slotId = '00000000-0000-4000-8000-000000000002';
const canary = 'private-response-cookie-error-canary';
const servers: Server[] = [];
function wall() {
  return {
    id: wallId,
    status: 'paused',
    slotCount: 1,
    slots: [{ id: slotId, position: 0, occupied: false }],
  };
}
async function fixture(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Fixture unavailable');
  return `http://127.0.0.1:${address.port}/walls/${wallId}`;
}
function config(target: string, extra: string[] = []) {
  return parseLoadArgs([
    '--target',
    target,
    '--requests',
    '12',
    '--concurrency',
    '3',
    ...extra,
  ]);
}
function cli(args: string[]) {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('./public-wall-load.ts', import.meta.url)), ...args],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (line) => (stdout += line));
  child.stderr.on('data', (line) => (stderr += line));
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, stdout, stderr }));
    },
  );
}
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe('public Wall local load tool', () => {
  it('computes nearest-rank quantiles with hand-checked boundaries', () => {
    const samples = [10, 1, 9, 2, 8, 3, 7, 4, 6, 5];
    expect(latencySummary(samples)).toEqual({
      samples: 10,
      meanMs: 5.5,
      p50Ms: 5,
      p95Ms: 10,
      p99Ms: 10,
      maxMs: 10,
    });
    expect(samples[0]).toBe(10);
    expect(latencySummary([])).toBeNull();
    expect(latencySummary([3])).toMatchObject({ p50Ms: 3, p95Ms: 3, p99Ms: 3 });
  });

  it.each([
    `https://127.0.0.1/walls/${wallId}`,
    `http://localhost/walls/${wallId}`,
    `http://example.invalid/walls/${wallId}`,
    `http://127.0.0.1:4000/walls/${wallId}?secret=${canary}`,
    `http://fixture:${canary}@127.0.0.1/walls/${wallId}`,
    `http://127.0.0.1/walls/${wallId}#fragment`,
    'http://127.0.0.1/auth/google/start',
    'http://127.0.0.1/walls/invalid',
  ])('rejects an unsupported target before a request: %s', (target) => {
    expect(() => parseLoadArgs(['--target', target])).toThrow();
  });

  it.each(
    [
      ['--requests', '0'],
      ['--requests', '100001'],
      ['--concurrency', '101'],
      ['--requests', '2', '--concurrency', '3'],
      ['--requests', '1.5'],
      ['--requests', '01'],
      ['--timeout-ms', '30001'],
      ['--response-bytes', '1048577'],
      ['--headers', canary],
      ['--requests', '12', '--requests', '12'],
      ['--unknown'],
    ].map((args) => ({ args })),
  )('rejects invalid limits/flags: $args', ({ args }) => {
    expect(() =>
      parseLoadArgs(['--target', `http://127.0.0.1/walls/${wallId}`, ...args]),
    ).toThrow();
  });

  it('accepts maximum bounded arguments without running that workload', () => {
    expect(
      parseLoadArgs([
        '--target',
        `http://127.0.0.1/walls/${wallId}`,
        '--requests',
        '100000',
        '--concurrency',
        '100',
        '--timeout-ms',
        '30000',
        '--response-bytes',
        '1048576',
      ]),
    ).toMatchObject({
      requests: 100000,
      concurrency: 100,
      timeoutMs: 30000,
      responseBytes: 1048576,
    });
  });

  it('allows IPv6 literal loopback and validates direct callers too', async () => {
    expect(
      parseLoadArgs(['--target', `http://[::1]:4000/walls/${wallId}`])
        .concurrency,
    ).toBe(5);
    await expect(
      runPublicWallLoad({
        ...config(`http://127.0.0.1/walls/${wallId}`),
        concurrency: 1000,
      }),
    ).rejects.toThrow();
  });

  it('bounds concurrency, makes only anonymous GETs and reports no target identifiers/body', async () => {
    let active = 0,
      peak = 0,
      reads = 0;
    const target = await fixture((req, res) => {
      reads++;
      active++;
      peak = Math.max(peak, active);
      expect(req.method).toBe('GET');
      expect(req.url).toBe(`/walls/${wallId}`);
      expect(req.headers.authorization).toBeUndefined();
      expect(req.headers.cookie).toBeUndefined();
      setTimeout(() => {
        active--;
        res.setHeader('Set-Cookie', `session=${canary}`);
        res.end(JSON.stringify({ ...wall(), extra: canary }));
      }, 5);
    });
    const report = await runPublicWallLoad(config(target));
    expect(reads).toBe(12);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(3);
    expect(report).toMatchObject({
      completedRequests: 12,
      successes: 12,
      failures: 0,
      interrupted: false,
      statusCounts: [0, 12, 0, 0, 0, 0],
    });
    expect(report.latencyMs.successfulReads!.samples).toBe(12);
    expect(report.completedPerSecond).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toMatch(
      new RegExp(`${canary}|${wallId}|${slotId}`),
    );
  });

  it('does not follow redirects or retry handled failures', async () => {
    let reads = 0,
      followed = 0;
    const target = await fixture((req, res) => {
      if (req.url === '/follow') followed++;
      reads++;
      res.statusCode = reads % 2 ? 302 : 503;
      res.setHeader('Location', '/follow');
      res.end(canary);
    });
    const report = await runPublicWallLoad(config(target));
    expect(reads).toBe(12);
    expect(followed).toBe(0);
    expect(report).toMatchObject({
      successes: 0,
      failures: 12,
      errors: { http: 12 },
      statusCounts: [0, 0, 6, 0, 6, 0],
    });
    expect(report.latencyMs.successfulReads).toBeNull();
  });

  it.each([
    'json',
    'id',
    'status',
    'count',
    'position',
    'duplicate',
    'occupancy',
  ])('rejects incoherent HTTP200 Wall responses: %s', async (mode) => {
    const target = await fixture((_req, res) => {
      const data = wall();
      if (mode === 'id') data.id = slotId;
      if (mode === 'status') data.status = ['paused'] as unknown as string;
      if (mode === 'count') data.slotCount = 2;
      if (mode === 'position') data.slots[0]!.position = 5;
      if (mode === 'duplicate') {
        data.slotCount = 2;
        data.slots.push({ ...data.slots[0]!, position: 1 });
      }
      if (mode === 'occupancy')
        delete (data.slots[0] as Partial<(typeof data.slots)[0]>)!.occupied;
      res.end(mode === 'json' ? canary : JSON.stringify(data));
    });
    const report = await runPublicWallLoad(config(target));
    expect(report.errors.invalidWall).toBe(12);
    expect(report.successes).toBe(0);
    expect(report.statusCounts).toEqual([0, 12, 0, 0, 0, 0]);
  });

  it('enforces response bytes without dumping content', async () => {
    const target = await fixture((_req, res) => res.end(canary.repeat(100)));
    const report = await runPublicWallLoad(
      config(target, ['--response-bytes', '100']),
    );
    expect(report.errors.bodyTooLarge).toBe(12);
    expect(JSON.stringify(report)).not.toContain(canary);
  });

  it('applies a whole-attempt deadline to a continuously streaming response', async () => {
    const target = await fixture((_req, res) => {
      res.writeHead(200);
      const timer = setInterval(() => res.write(' '), 2);
      res.once('close', () => clearInterval(timer));
    });
    const report = await runPublicWallLoad(
      config(target, ['--timeout-ms', '30']),
    );
    expect(report.errors.timeout).toBe(12);
    expect(report.durationSeconds).toBeLessThan(5);
  });

  it('counts broken connections without exposing raw socket errors', async () => {
    const target = await fixture((req) => req.socket.destroy());
    const report = await runPublicWallLoad(config(target));
    expect(report.errors.network).toBe(12);
    expect(report.statusCounts).toEqual([0, 0, 0, 0, 0, 12]);
  });

  it('cancels in-flight requests and stops scheduling after interruption', async () => {
    const controller = new AbortController();
    let started = 0;
    const target = await fixture(() => {
      started++;
      if (started === 3) controller.abort();
    });
    const report = await runPublicWallLoad(config(target), controller.signal);
    expect(report).toMatchObject({
      interrupted: true,
      completedRequests: 3,
      successes: 0,
      errors: { aborted: 3 },
    });
    expect(started).toBe(3);
    const empty = await runPublicWallLoad(config(target), controller.signal);
    expect(empty.completedRequests).toBe(0);
    expect(empty.latencyMs.allAttempts).toBeNull();
  });

  it('executes directly with Node24 and returns the CLI success/failure/input exit contract', async () => {
    const target = await fixture((_req, res) =>
      res.end(JSON.stringify(wall())),
    );
    const success = await cli([
      '--target',
      target,
      '--requests',
      '2',
      '--concurrency',
      '1',
    ]);
    expect(success.code).toBe(0);
    expect(success.stderr).toBe('');
    expect(JSON.parse(success.stdout)).toMatchObject({
      completedRequests: 2,
      successes: 2,
    });
    const badTarget = await fixture((_req, res) => {
      res.statusCode = 503;
      res.end(canary);
    });
    const failure = await cli([
      '--target',
      badTarget,
      '--requests',
      '2',
      '--concurrency',
      '1',
    ]);
    expect(failure.code).toBe(1);
    expect(JSON.parse(failure.stdout).errors.http).toBe(2);
    const invalid = await cli([
      '--target',
      `http://example.invalid/?secret=${canary}`,
    ]);
    expect(invalid.code).toBe(2);
    expect(invalid.stdout).toBe('');
    expect(invalid.stderr).not.toContain(canary);
  });

  it('runs the CLI SIGINT handler portably and reports incomplete work with exit130', async () => {
    let interrupt: () => void = () => {};
    let reads = 0;
    const target = await fixture(() => {
      reads++;
      if (reads === 1) interrupt();
    });
    // Deliver the process event via a synthetic preload so Windows and POSIX
    // exercise the same real CLI handler without relying on OS kill semantics.
    const preload =
      'data:text/javascript,' +
      encodeURIComponent(
        "process.once('message',()=>{process.emit('SIGINT');process.disconnect();});",
      );
    const child = spawn(
      process.execPath,
      [
        '--import',
        preload,
        fileURLToPath(new URL('./public-wall-load.ts', import.meta.url)),
        '--target',
        target,
        '--requests',
        '12',
        '--concurrency',
        '1',
      ],
      { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
    );
    interrupt = () => child.send('interrupt');
    let stdout = '',
      stderr = '';
    child.stdout!.on('data', (line) => (stdout += line));
    child.stderr!.on('data', (line) => (stderr += line));
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    expect(code).toBe(130);
    expect(stderr).toBe('');
    expect(reads).toBe(1);
    expect(JSON.parse(stdout)).toMatchObject({
      plannedRequests: 12,
      completedRequests: 1,
      interrupted: true,
      failures: 1,
    });
  });
});
