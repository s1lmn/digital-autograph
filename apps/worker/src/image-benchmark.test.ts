import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ImageProcessingError } from './image-processing';
import {
  latencySummary,
  measureFixture,
  parseBenchmarkOptions,
} from './image-benchmark';
import type { SyntheticFixture } from './image-benchmark';
import { runIsolatedBenchmark } from './image-benchmark-cli';

const defaults = parseBenchmarkOptions([]);
const fakeFixture: SyntheticFixture = {
  name: 'canvas',
  source: 'canvas',
  width: 1,
  height: 1,
  contentType: 'image/png',
  bytes: Buffer.from('synthetic'),
};
const fakeOutput = { bytes: Buffer.alloc(7), width: 1, height: 1 };

describe('bounded synthetic image benchmark', () => {
  it('defaults to one processing lane and accepts only bounded integer options and fixture names', () => {
    expect(defaults).toEqual({
      fixture: 'all',
      iterations: 5,
      warmup: 1,
      concurrency: 1,
      timeoutMs: 60_000,
    });
    expect(
      parseBenchmarkOptions([
        '--fixture=photo-large',
        '--iterations=100',
        '--warmup=0',
        '--concurrency=4',
        '--timeout-ms=120000',
      ]),
    ).toEqual({
      fixture: 'photo-large',
      iterations: 100,
      warmup: 0,
      concurrency: 4,
      timeoutMs: 120_000,
    });
  });

  it.each([
    '--iterations=0',
    '--iterations=101',
    '--iterations=-1',
    '--iterations=1.5',
    '--iterations=1e2',
    '--iterations=Infinity',
    '--iterations=9007199254740992',
    '--warmup=6',
    '--concurrency=0',
    '--concurrency=5',
    '--timeout-ms=999',
    '--timeout-ms=120001',
    '--fixture=/private/image.png',
    '--fixture=https://example.invalid/secret',
    '--input=original.png',
    '--output=result.png',
    '--iterations',
    '5',
  ])('rejects invalid or external input: %s', (arg) => {
    expect(() => parseBenchmarkOptions([arg])).toThrow('INVALID_ARGUMENTS');
  });

  it('rejects duplicate flags instead of silently overriding the resource budget', () => {
    expect(() =>
      parseBenchmarkOptions(['--iterations=1', '--iterations=100']),
    ).toThrow('INVALID_ARGUMENTS');
  });

  it('uses nearest-rank percentiles, leaves inputs intact and makes zero-success latency unavailable', () => {
    const input = Array.from({ length: 20 }, (_, i) => 20 - i);
    expect(latencySummary(input)).toMatchObject({
      samples: 20,
      p50: 10,
      p95: 19,
      p99: 20,
    });
    expect(input[0]).toBe(20);
    expect(latencySummary([])).toMatchObject({
      samples: 0,
      p50: null,
      p95: null,
      p99: null,
    });
    expect(latencySummary([42])).toMatchObject({ p50: 42, p95: 42, p99: 42 });
  });

  it('separates warmup failures, successful latency and failed attempts without exposing error details', async () => {
    let call = 0;
    const result = await measureFixture(
      fakeFixture,
      { ...defaults, iterations: 3 },
      async () => {
        call++;
        if (call === 1) throw new ImageProcessingError('EMPTY_AUTOGRAPH');
        if (call === 2) throw new Error('private-key-and-token');
        return fakeOutput;
      },
    );
    expect(result.warmup).toEqual({ attempted: 1, failed: 1 });
    expect(result.measured).toEqual({
      attempted: 3,
      succeeded: 2,
      failed: 1,
      errorRate: 1 / 3,
    });
    expect(result.errors).toEqual([
      { phase: 'warmup', code: 'EMPTY_AUTOGRAPH', count: 1 },
      { phase: 'measured', code: 'PROCESSING_FAILURE', count: 1 },
    ]);
    expect(result.latencyMs.samples).toBe(2);
    expect(result.outputBytes).toBe(14);
    expect(result.successfulOperationsPerSecond).toBeCloseTo(
      2000 / result.elapsedMs,
    );
    expect(JSON.stringify(result)).not.toContain('private-key-and-token');
  });

  it('bounds overlapping operations, completes every attempt and does not stall on a rejection', async () => {
    let active = 0,
      maximum = 0,
      calls = 0;
    const result = await measureFixture(
      fakeFixture,
      { ...defaults, warmup: 0, iterations: 7, concurrency: 2 },
      async () => {
        calls++;
        active++;
        maximum = Math.max(maximum, active);
        await new Promise<void>((resolve) => setImmediate(resolve));
        active--;
        if (calls < 4) throw new ImageProcessingError('INVALID_IMAGE');
        return fakeOutput;
      },
    );
    expect(calls).toBe(7);
    expect(maximum).toBe(2);
    expect(active).toBe(0);
    expect(result.measured.attempted).toBe(
      result.measured.succeeded + result.measured.failed,
    );
    expect(result.measured.failed).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.count).toBe(result.measured.failed);
  });

  it('does not manufacture percentiles or throughput when every operation fails', async () => {
    const result = await measureFixture(
      fakeFixture,
      { ...defaults, warmup: 0, iterations: 2 },
      async () => {
        throw new Error('secret');
      },
    );
    expect(result.latencyMs.p50).toBeNull();
    expect(result.measured.errorRate).toBe(1);
    expect(result.successfulOperationsPerSecond).toBe(0);
    expect(result.outputBytes).toBe(0);
  });

  it('runs every fixed fixture through the actual restricted processor in a child', () => {
    const result = runIsolatedBenchmark({
      ...defaults,
      iterations: 1,
      warmup: 0,
    });
    expect(result.exitCode).toBe(0);
    expect(result.report).toMatchObject({
      schemaVersion: 1,
      status: 'ok',
      options: { concurrency: 1 },
      cases: [
        {
          fixture: 'canvas',
          input: { width: 512, height: 256, source: 'canvas' },
          measured: { succeeded: 1, failed: 0 },
        },
        {
          fixture: 'photo',
          input: { width: 1280, height: 720, source: 'photo' },
          measured: { succeeded: 1, failed: 0 },
        },
        {
          fixture: 'photo-large',
          input: { width: 2400, height: 1600, source: 'photo' },
          measured: { succeeded: 1, failed: 0 },
        },
      ],
    });
    expect(JSON.stringify(result.report)).not.toContain('base64');
  }, 70_000);

  it('kills a long-running child and returns a failure instead of partial success', () => {
    const result = runIsolatedBenchmark({
      ...defaults,
      fixture: 'photo-large',
      iterations: 100,
      warmup: 5,
      timeoutMs: 1000,
    });
    expect(result).toEqual({
      exitCode: 1,
      report: { schemaVersion: 1, status: 'failed', code: 'BENCHMARK_TIMEOUT' },
    });
  }, 15_000);

  it('rejects invalid CLI input with a nonzero exit and without echoing supplied paths or URLs', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(new URL('./image-benchmark-cli.ts', import.meta.url)),
        '--fixture=https://example.invalid/private-token',
      ],
      { encoding: 'utf8', timeout: 15_000, windowsHide: true },
    );
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toEqual({
      schemaVersion: 1,
      status: 'failed',
      code: 'INVALID_ARGUMENTS',
    });
    expect(result.stdout + result.stderr).not.toContain('private-token');
  }, 20_000);
});
