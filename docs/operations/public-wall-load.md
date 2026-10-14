# Local public Wall read load probe — EGO-156

This standalone Node 24 tool prepares the public-read portion of EGO-113. It
does not execute or complete the final staging spike/capacity review. Monitoring,
feature freeze and reservation/payment acceptance remain dependencies of that
larger task. No dependency on the open API metrics PR is required to use this
client-side probe.

## Run a baseline

Start the local API with its isolated development/test database and create a
readable synthetic Wall through the existing owner API. Scheduled, live, paused
and ended Walls are public; draft/archived Walls return 404. Replace the sample
UUID below with that local Wall's actual ID:

```sh
pnpm load:public-wall --target http://127.0.0.1:4000/walls/00000000-0000-4000-8000-000000000001 --requests 100 --concurrency 5
```

Or invoke `node apps/api/scripts/public-wall-load.ts` with the same arguments.
Only erasable TypeScript syntax and Node built-ins are used; no loader, runtime
installation or provider account is needed. The script has a dedicated typecheck
included in the normal workspace `typecheck` command.

The target must be plain HTTP, canonical literal `127.0.0.1` or `[::1]`, and
exactly `/walls/<UUID>`. Hostnames (including `localhost`), credentials, queries,
fragments, other paths and external targets are rejected before any request.
Only anonymous GET is available. The client does not send cookies/auth, follow
redirects, retry failures, fetch media or call mutation/auth/payment endpoints.
No fixtures, migrations or server configuration are changed by the tool.

Flags are positive whole numbers; duplicates and unknown flags fail:

- `--requests`: default 100, maximum 100000.
- `--concurrency`: default 5, maximum 100 and no greater than request count.
- `--timeout-ms`: default 5000, maximum 30000; deadline spans the whole attempt,
  including response streaming. It is not reset by incoming bytes.
- `--response-bytes`: default/maximum 1048576. Larger replies are aborted. One
  bounded buffer per successful-status response avoids per-chunk accumulation.

Start with the default baseline, then explicitly increase the local workload.
The upper bounds are tooling limits, not approved launch gates or assumptions
about how many visitors the application can serve. Literal loopback does not
identify the service behind a local port forward: use only the intended isolated
local API, not a tunnel to staging/production.

## Interpret the JSON result

The tool writes one JSON object to stdout. It includes local origin and the fixed
route template `/walls/:id`, never the actual Wall/Slot IDs, response bodies,
headers/cookies, credentials, raw exceptions or provider details. Output can be
redirected to a file using the operator's shell if needed.

`plannedRequests` is the requested count; `completedRequests` counts settled
attempts, including failures. `successes` requires HTTP 200 and a minimal coherent
Wall shape: requested ID, public status, slot count 1–1000, ordered contiguous
positions, unique UUID slot IDs and boolean occupancy. This is not a full API
schema/privacy validator. Unexpected body shape is `invalidWall`; an HTTP 200
with invalid JSON is not reported as a successful read.

`statusCounts` positions correspond to 1xx, 2xx, 3xx, 4xx, 5xx, then no/invalid
HTTP response. `errors` separately counts HTTP non-200, network, timeout,
oversized body, invalid Wall and aborted attempts. A response that times out
after its 200 headers still has a 2xx status and a timeout failure. Neither
redirects nor failures generate replacement requests.

`durationSeconds` and `completedPerSecond` measure client elapsed wall time and
settled-attempt throughput. `latencyMs` contains separate summaries for all
attempts and successful reads: sample count, mean, nearest-rank p50/p95/p99 and
maximum, in milliseconds. Empty sample groups are `null`. Timing includes
connection/pool wait, response download and the minimal body check. An aborted
attempt's duration is its observed cancellation latency, not server throughput.

Concurrency uses a **closed loop**: each worker starts its next request after
the previous attempt settles. A slow server therefore lowers the offered rate.
These quantiles are client observations under that workload, not an unbiased
open-loop arrival spike, API processing-time percentiles, DB lock measurements,
browser/mobile performance, or a certified capacity limit. Record CPU/memory,
DB/pool/queue and ingress observations separately during the later full EGO-113
exercise; this read-only tool cannot prove reservation/payment invariants.

## Exit and interruption

- Exit 0: all planned reads succeeded.
- Exit 1: at least one settled attempt failed; the JSON still describes it.
- Exit 2: invalid arguments/setup; fixed stderr text, no input/exception echo.
- Exit 130: SIGINT/SIGTERM interrupted the probe. New work stops, in-flight
  requests are cancelled, and JSON marks `interrupted=true`; unscheduled requests
  are not invented or counted as completed.

The agent's sockets and per-attempt timers are cleaned up after completion or
interruption. SIGINT handling is covered by a portable synthetic process-event
test; it does not certify every host's signal/terminal behavior.

Isolated loopback regression fixtures verify the client and CLI contract. Their
speed is not evidence for the real API/database capacity; no real staging load
run has been performed as part of this preparation.

References: [Node 24 HTTP](https://nodejs.org/docs/latest-v24.x/api/http.html) and
[Node TypeScript stripping](https://nodejs.org/docs/latest-v24.x/api/typescript.html).
