# Aggregate API response metrics — EGO-155

The API emits `API_METRICS` at info level through its existing Pino logger after
each nonempty 60-second sampling window. Graceful close emits a final partial
window. The timer starts after Fastify readiness, is unreferenced, and is cleared
on close. Empty windows produce no event. This is an early part of EGO-111's API
latency/error instrumentation; external dashboards and alert delivery remain
separate work.

## Payload and interpretation

Each event has the ordinary process-level Pino timestamp, PID and hostname;
`windowSeconds` measures the actual window with a monotonic clock. `total` covers
all completed responses. `routes` contains method plus registered server route
templates such as `/walls/:id`, with the same counters:

- `responses`: completed HTTP response count, including handled 4xx and 5xx.
- `statusCounts`: six positions, respectively 1xx, 2xx, 3xx, 4xx, 5xx and invalid
  or other status. Counts use the final public response status, not a provider's
  error metadata. Auth rejections, incident-control 503s and readiness failures
  are observable without changing their responses.
- `timedResponses` and `invalidDurations`: durations that can be measured and
  durations excluded as nonfinite, negative or greater than 24 hours. An invalid
  duration still contributes to response/status counts; it does not become a
  zero-latency success. Normal Fastify elapsed times are measured in milliseconds.
- `durationSumMs`, `durationMaxMs`: sum and maximum for valid durations.
- `latencyLeMs`: fixed bounds 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000,
  10000 milliseconds. `latencyLeCounts` at each index counts valid durations
  **less than or equal** to that bound. Buckets are cumulative. The implicit
  positive-infinity bucket is `timedResponses`.

For a positive window length, response rate is `responses / windowSeconds`.
The 5xx fraction is `statusCounts[4] / responses`; present 4xx separately rather
than interpreting every denial as an outage. Average latency is
`durationSumMs / timedResponses` when the denominator is positive. Histograms
provide bounds for quantiles, not an exact p95/p99. Sum compatible bucket counts
across windows or replicas; do not average per-instance percentiles or maxima.
The window duration can exceed 60 seconds under event-loop pressure. A partial
shutdown window can be very short; use its actual duration, not a fixed minute.

## Cardinality and private-data boundary

Labels are accepted only through Fastify's trusted `onRoute` definitions. Method
labels come from a finite set; route labels are at most 256 characters, reject
query/fragment/newline-bearing definitions, and registration is capped at 128
method/template pairs per process. Unknown routes use `<unmatched>`; unknown
methods use `OTHER`. A sampling window emits at most 128 route rows, reserving
the last for `OTHER <overflow>` when necessary. Global totals include overflow
traffic, and the collector resets counters/rows after every drain.

Never register request-derived routes or call this collector with raw request
URLs. Normal application routes are static server definitions. Metrics never
read or retain actual path parameter values, query strings, headers, IPs,
cookies, sessions, body/response contents, user/request/order/payment identifiers
or exception text. No public metrics route, SaaS token, migration or new external
dependency is introduced. Existing individual request logs remain a separate
logging stream with their existing policy; this change does not redefine it.

## Operational limits

Use the existing approved application-log pipeline to select `event=API_METRICS`
and distinguish deployed replicas/releases with its process/deployment metadata.
No live collector/dashboard/alert destination was configured in this change.
Logging at a level above info or with logging disabled hides the events.

This is process-local, best-effort telemetry, not a financial or audit ledger.
It counts requests reaching Fastify `onResponse`; disconnected/aborted requests,
requests rejected before Fastify, streams that never finish, abrupt process loss
and unavailable log sinks can lose observations. A sink exception does not reject
HTTP requests or graceful close; the drained window is not retried. Absence of an
event cannot distinguish an idle API from an outage. Existing health/ingress
monitoring is still needed. Metrics do not perform a DB/storage probe or prove
payment fulfillment, alert delivery, SLO acceptance or staging readiness.

Regression coverage uses the actual Fastify/Pino stream for parameterized/nested
routes, private request canaries, success/handled failures/unexpected 5xx/404,
disjoint windows, idle windows, close cleanup and a failed sink. Collector tests
cover inclusive histogram boundaries, reset, invalid timings and overflow.

References: [Fastify hooks](https://fastify.dev/docs/latest/Reference/Hooks/) and
[Fastify reply elapsed time](https://fastify.dev/docs/latest/Reference/Reply/).
