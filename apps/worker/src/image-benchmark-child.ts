import { parseBenchmarkOptions, runBenchmark } from './image-benchmark';

try {
  const report = await runBenchmark(
    parseBenchmarkOptions(process.argv.slice(2)),
  );
  process.stdout.write(JSON.stringify(report) + '\n');
  process.exitCode = report.status === 'ok' ? 0 : 1;
} catch {
  // Never emit exception text, paths, image bytes, or environment values.
  process.stdout.write(
    JSON.stringify({
      schemaVersion: 1,
      status: 'failed',
      code: 'BENCHMARK_FAILED',
    }) + '\n',
  );
  process.exitCode = 1;
}
