import { performance } from 'node:perf_hooks';
import sharp from 'sharp';
import {
  ImageProcessingError,
  processAutographImage,
  restrictWorkerImageLoaders,
} from './image-processing';

export const fixtureNames = ['canvas', 'photo', 'photo-large'] as const;
type FixtureName = (typeof fixtureNames)[number];
export type BenchmarkOptions = {
  fixture: FixtureName | 'all';
  iterations: number;
  warmup: number;
  concurrency: number;
  timeoutMs: number;
};

export function parseBenchmarkOptions(args: string[]): BenchmarkOptions {
  const values = new Map<string, string>();
  for (const arg of args) {
    const match =
      /^--(fixture|iterations|warmup|concurrency|timeout-ms)=([^=]+)$/.exec(
        arg,
      );
    if (!match || values.has(match[1]!)) throw new Error('INVALID_ARGUMENTS');
    values.set(match[1]!, match[2]!);
  }
  function integer(key: string, fallback: number, min: number, max: number) {
    const raw = values.get(key) ?? String(fallback);
    if (!/^\d+$/.test(raw)) throw new Error('INVALID_ARGUMENTS');
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw new Error('INVALID_ARGUMENTS');
    return value;
  }
  const fixture = values.get('fixture') ?? 'all';
  if (fixture !== 'all' && !fixtureNames.includes(fixture as FixtureName))
    throw new Error('INVALID_ARGUMENTS');
  return {
    fixture: fixture as BenchmarkOptions['fixture'],
    iterations: integer('iterations', 5, 1, 100),
    warmup: integer('warmup', 1, 0, 5),
    concurrency: integer('concurrency', 1, 1, 4),
    timeoutMs: integer('timeout-ms', 60_000, 1_000, 120_000),
  };
}

export type SyntheticFixture = {
  name: FixtureName;
  width: number;
  height: number;
  source: 'canvas' | 'photo';
  contentType: string;
  bytes: Buffer;
};

export async function createSyntheticFixture(
  name: FixtureName,
): Promise<SyntheticFixture> {
  const [width, height]: [number, number] =
    name === 'canvas'
      ? [512, 256]
      : name === 'photo'
        ? [1280, 720]
        : [2400, 1600];
  const source = name === 'canvas' ? 'canvas' : 'photo';
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inkY = height * 0.5 + Math.sin(x / (width / 18)) * height * 0.06;
      const ink =
        x > width * 0.2 &&
        x < width * 0.8 &&
        Math.abs(y - inkY) < Math.max(2, height / 150);
      const paper =
        Math.round(210 + (20 * x) / width) + ((x * 17 + y * 31) % 5);
      const offset = (y * width + x) * 4;
      pixels[offset] = ink ? 20 : source === 'photo' ? paper : 0;
      pixels[offset + 1] = ink ? 40 : source === 'photo' ? paper : 0;
      pixels[offset + 2] = ink ? 100 : source === 'photo' ? paper : 0;
      pixels[offset + 3] = ink || source === 'photo' ? 255 : 0;
    }
  }
  const pipeline = sharp(pixels, { raw: { width, height, channels: 4 } });
  return {
    name,
    width,
    height,
    source,
    contentType: source === 'canvas' ? 'image/png' : 'image/jpeg',
    bytes: await (
      source === 'canvas' ? pipeline.png() : pipeline.jpeg({ quality: 85 })
    ).toBuffer(),
  };
}

export function latencySummary(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p: number) =>
    sorted.length ? sorted[Math.ceil(p * sorted.length) - 1]! : null;
  return {
    population: 'successful measured operations',
    samples: sorted.length,
    method: 'nearest-rank',
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
  };
}

export async function measureFixture(
  fixture: SyntheticFixture,
  options: BenchmarkOptions,
  processor = processAutographImage,
) {
  const errors: {
    phase: 'warmup' | 'measured';
    code: string;
    count: number;
  }[] = [];
  const latencies: number[] = [];
  let warmupFailures = 0;
  let outputBytes = 0;
  let sampledRssMaxBytes = process.memoryUsage().rss;
  async function execute(phase: 'warmup' | 'measured') {
    const start = performance.now();
    try {
      const result = await processor(
        fixture.bytes,
        fixture.source,
        fixture.contentType,
      );
      if (phase === 'measured') {
        latencies.push(performance.now() - start);
        outputBytes += result.bytes.length;
      }
    } catch (error) {
      const code =
        error instanceof ImageProcessingError
          ? error.code
          : 'PROCESSING_FAILURE';
      const existing = errors.find(
        (item) => item.phase === phase && item.code === code,
      );
      if (existing) existing.count++;
      else errors.push({ phase, code, count: 1 });
      if (phase === 'warmup') warmupFailures++;
    }
    sampledRssMaxBytes = Math.max(
      sampledRssMaxBytes,
      process.memoryUsage().rss,
    );
  }
  for (let i = 0; i < options.warmup; i++) await execute('warmup');
  // Warmup is sequential; measured operations use at most the requested lanes.
  sampledRssMaxBytes = process.memoryUsage().rss;
  const cpuStart = process.cpuUsage();
  const start = performance.now();
  let next = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(options.concurrency, options.iterations) },
      async () => {
        while (next < options.iterations) {
          next++;
          await execute('measured');
        }
      },
    ),
  );
  const elapsedMs = performance.now() - start;
  const cpu = process.cpuUsage(cpuStart);
  const succeeded = latencies.length;
  const failed = options.iterations - succeeded;
  return {
    fixture: fixture.name,
    input: {
      width: fixture.width,
      height: fixture.height,
      bytes: fixture.bytes.length,
      source: fixture.source,
    },
    warmup: { attempted: options.warmup, failed: warmupFailures },
    measured: {
      attempted: options.iterations,
      succeeded,
      failed,
      errorRate: failed / options.iterations,
    },
    elapsedMs,
    successfulOperationsPerSecond:
      elapsedMs > 0 ? (succeeded * 1000) / elapsedMs : 0,
    latencyMs: latencySummary(latencies),
    outputBytes,
    cpuMs: { user: cpu.user / 1000, system: cpu.system / 1000 },
    sampledRssMaxBytes,
    errors,
  };
}

export async function runBenchmark(options: BenchmarkOptions) {
  restrictWorkerImageLoaders();
  const cases = [];
  for (const name of options.fixture === 'all'
    ? fixtureNames
    : [options.fixture]) {
    const fixture = await createSyntheticFixture(name);
    cases.push(await measureFixture(fixture, options));
  }
  return {
    schemaVersion: 1,
    status: cases.some(
      (result) => result.measured.failed || result.warmup.failed,
    )
      ? 'failed'
      : 'ok',
    scope:
      'synthetic local processor only; no queue, database, storage or network',
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      sharp: sharp.versions.sharp,
      vips: sharp.versions.vips,
      sharpConcurrency: sharp.concurrency(),
    },
    options,
    measurement: {
      latency:
        'Successful calls only; excludes fixture generation and warmup. Includes waiting inside each measured processor call.',
      throughput:
        'Successful measured operations / full measured wall time including failed calls.',
      cpu: 'Child-process CPU delta over measured phase, including all libvips threads; not CPU utilization or capacity.',
      memory:
        'RSS sampled before and after measured operations, not peak RSS; includes retained warmup/fixture/cache memory. Cases share one process.',
    },
    cases,
  };
}
