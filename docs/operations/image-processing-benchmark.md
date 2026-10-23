# Local synthetic image-processing benchmark

EGO-163 provides early tooling for EGO-113 on the already merged worker processor.
Run it locally with Node 24 and the repository's pinned pnpm/dependencies installed:

```sh
pnpm benchmark:images --help
pnpm benchmark:images --fixture=all --iterations=5 --warmup=1 --concurrency=1 --timeout-ms=60000
# Direct entrypoint for JSON consumers without a package-manager banner:
node --import tsx apps/worker/src/image-benchmark-cli.ts --fixture=all --iterations=5 --warmup=1 --concurrency=1 --timeout-ms=60000
```

The CLI writes one JSON report to stdout; the direct entrypoint avoids
package-manager banners when consuming JSON. No `.env` loader, service or credentials
are needed. The tool imports only the image processor and generates all inputs in
memory. It does not accept files, URLs, arbitrary dimensions, output paths or image
contents, and it never writes images, uploads them or accesses the database.

## Workload and resource limits

Fixed fixtures contain a deterministic sparse blue stroke:

- `canvas`: transparent 512 × 256 PNG.
- `photo`: 1280 × 720 JPEG, quality 85, with light paper and a small deterministic
  lighting/noise pattern.
- `photo-large`: the same scene at 2400 × 1600 pixels.
- `all` (default): each fixture in that order, sequentially in one child process.

These cover both processor branches with synthetic successful inputs. They do not
represent real camera diversity, worst-case compressed inputs or quality
acceptance. The existing processor tests cover malformed and policy-limit inputs.

Every fixture has 1–100 measured operations (default 5), preceded by 0–5 sequential
warmup operations (default 1). Measured concurrency is 1–4 (default 1) and cannot
exceed the number of iterations. Counts are **per fixture**, not per lane. All
flags use `--name=value`; duplicate, unknown, fractional and out-of-range values
are rejected before launching processing.

The parent starts a child with the worker's JPEG/PNG/raw loader restrictions and a
1–120 second timeout (default 60 seconds). The deadline includes child startup,
fixture generation, warmup and all measured cases. On expiry the parent kills the
child with SIGKILL (termination on Windows) and returns `BENCHMARK_TIMEOUT`; no
partial results count as success. This external deadline also bounds synchronous
JavaScript photo-cleanup loops that could delay an in-process timer. There are no
retries. Running the internal child entrypoint directly bypasses the supervisor;
always use the documented package script.

Larger/concurrent runs consume significant CPU and memory. The bounds are workload
limits, not a memory quota. Do not change worker replicas, queue concurrency,
leases or admission limits from these local numbers. The deployed worker handles
one job per process; concurrency above one is an explicit experiment only.

## Reading the report

`schemaVersion: 1` reports runtime Node/Sharp/libvips versions, platform, architecture,
Sharp thread concurrency and options alongside each fixture's dimensions and byte
size. Keep runtime, command, hardware and revision alongside any saved report when
comparing runs. Use identical options and fixtures; avoid unrelated concurrent
work. There is no pass/fail latency or throughput threshold.

- `latencyMs` uses nearest-rank p50/p95/p99 of **successful measured calls only**.
  It excludes fixture generation and warmup but includes waiting inside each
  processor call. It is not queue-to-result latency. An empty population has null
  percentiles; low sample counts make tail percentiles uninformative.
- `successfulOperationsPerSecond` divides measured successes by the full measured
  wall duration, including failed calls. `measured.errorRate` counts failures over
  all measured attempts. Warmup errors are reported separately and still fail the
  run. No rejection or timeout is silently retried or removed from the failure
  signal.
- `cpuMs` is the child-process user/system CPU delta over each measured phase,
  including libvips threads. It is not CPU utilization or a capacity estimate.
- `sampledRssMaxBytes` samples RSS before the measured phase and after operations;
  it **is not peak RSS**. Fixture, retained warmup allocations, Sharp cache and
  prior cases in the same child may contribute. Run individual fixtures in fresh
  invocations to compare their retained memory more fairly.
- `outputBytes` sums successful measured output lengths without retaining or
  serializing their contents. `errors` groups only stable processor error codes
  or `PROCESSING_FAILURE` by warmup/measured phase; exception messages are omitted.

Exit 0 means all warmup and measured processor calls succeeded. Exit 1 means a
processing failure, timeout, startup/child failure or invalid child report. Exit 2
means invalid CLI arguments. Failure output contains stable codes, never raw error
details. CLI tests verify real processing and timeout behavior; CI does not certify
performance and does not enforce speed thresholds.

## Remaining EGO-113 acceptance

This tool measures local CPU/image processing only. EGO-113 still needs monitoring,
representative staging-like workloads, queue/S3 throughput, auth/upload/read
traffic, reservation contention/payment invariants, DB/pool/lock metrics, real
resource peaks, capacity assumptions and the spike runbook. Local benchmark
success does not establish safe pilot capacity, an SLO or public-beta readiness.

See [processing lifecycle and privacy boundary](../architecture/autograph-processing.md).
