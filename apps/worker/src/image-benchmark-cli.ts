import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseBenchmarkOptions } from './image-benchmark';
import type { BenchmarkOptions } from './image-benchmark';

const usage =
  'Usage: pnpm benchmark:images [--fixture=all|canvas|photo|photo-large] [--iterations=1..100] [--warmup=0..5] [--concurrency=1..4] [--timeout-ms=1000..120000]';

export function runIsolatedBenchmark(options: BenchmarkOptions) {
  const args = [
    `--fixture=${options.fixture}`,
    `--iterations=${options.iterations}`,
    `--warmup=${options.warmup}`,
    `--concurrency=${options.concurrency}`,
    `--timeout-ms=${options.timeoutMs}`,
  ];
  // A separate process is essential: photo cleanup also executes synchronous CPU loops.
  // An in-process Promise.race/timer cannot enforce their deadline.
  const child = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      fileURLToPath(new URL('./image-benchmark-child.ts', import.meta.url)),
      ...args,
    ],
    {
      encoding: 'utf8',
      timeout: options.timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  );
  if (
    child.error ||
    child.signal ||
    (child.status !== 0 && child.status !== 1)
  ) {
    const timedOut =
      child.error && 'code' in child.error && child.error.code === 'ETIMEDOUT';
    return {
      exitCode: 1,
      report: {
        schemaVersion: 1,
        status: 'failed',
        code: timedOut ? 'BENCHMARK_TIMEOUT' : 'BENCHMARK_CHILD_FAILED',
      },
    };
  }
  try {
    const report: unknown = JSON.parse(child.stdout);
    if (
      !report ||
      typeof report !== 'object' ||
      !('status' in report) ||
      (report.status !== 'ok' && report.status !== 'failed') ||
      (report.status === 'ok' && child.status !== 0)
    )
      throw new Error();
    return { exitCode: report.status === 'ok' ? 0 : 1, report };
  } catch {
    return {
      exitCode: 1,
      report: {
        schemaVersion: 1,
        status: 'failed',
        code: 'BENCHMARK_CHILD_FAILED',
      },
    };
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.slice(2).length === 1 && process.argv[2] === '--help') {
    process.stdout.write(usage + '\n');
  } else {
    try {
      const result = runIsolatedBenchmark(
        parseBenchmarkOptions(process.argv.slice(2)),
      );
      process.stdout.write(JSON.stringify(result.report) + '\n');
      process.exitCode = result.exitCode;
    } catch {
      process.stdout.write(
        JSON.stringify({
          schemaVersion: 1,
          status: 'failed',
          code: 'INVALID_ARGUMENTS',
        }) + '\n',
      );
      process.stderr.write(usage + '\n');
      process.exitCode = 2;
    }
  }
}
