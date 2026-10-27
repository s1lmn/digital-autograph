# Safe runtime diagnostics (EGO-139)

`packages/observability` is a dependency-free boundary shared by API and worker.
Error details contain only a finite allowlist of error names, Node/PostgreSQL
codes and integer HTTP status codes. Unknown metadata is dropped. The helper
never enumerates an exception, follows `cause`, invokes `toJSON`, or emits
`message`, `stack`, SQL detail, credentials, provider payloads or signed URLs.
Throwing getters/proxies produce a bounded `UnknownError` record.

Fastify's error serializer uses that boundary. Its Pino `logMethod` hook also
replaces error-bearing messages and interpolation arguments: a custom `err`
serializer alone does not stop Pino from copying `error.message` into `msg`.
The serializer's required `message` and `stack` fields contain only fixed
`[REDACTED]` markers; `type` repeats the bounded error name.
Error-bearing merged extras are dropped; only bounded request/response
serializers and a finite server-owned event set are retained. Normal request
logs keep method, query-free path and the existing request correlation ID.
Request cookies/authorization and response headers/bodies are not emitted.
Never pass private data as an ordinary log message or child binding: this
boundary protects exception reporting, not arbitrary intentional logging.

Unexpected HTTP 5xx exceptions produce `{ "error": { "code": "INTERNAL_ERROR" } }`
with the selected server status and a correlated `API_REQUEST_FAILED` log.
An upstream provider's `$metadata.httpStatusCode` is diagnostic only and never
selects the public response status.
Known handled domain/API responses are unchanged. Thrown 4xx errors retain
Fastify's existing client-error contract; only their diagnostic output changes.
Startup/listen and shutdown logs carry `API_STARTUP_FAILED` /
`API_SHUTDOWN_FAILED`. Errors caught outside API/worker bootstrap emit one JSON
record with level 50, timestamp, runtime, `STARTUP_FAILED` and bounded metadata;
the process still exits with status 1. Existing shutdown/cleanup and worker
lease/retry behavior are unchanged.

Diagnose production failures using event, request ID, response status and the
allowed system code (for example `ECONNREFUSED`, `23505`, `40P01`). Raw stack and
provider/configuration messages are deliberately unavailable in these logs.
Reproduce a failure with synthetic local configuration when more detail is
needed; do not temporarily enable raw error logging on real traffic.
Adding a diagnostic field requires a privacy review and regression coverage.

`pnpm test:build-smoke` checks normal built API startup/login and both built
runtimes' safe failure path. A temporary preload throws an exception containing
synthetic secret canaries before any DB/storage/provider call. Both children
must exit 1, emit valid bounded JSON and exclude every canary. The temporary
fixture is removed after its resolved path is checked. Unit tests additionally
capture actual Fastify/Pino output, fallback 4xx logging, nested/cyclic errors,
extra arguments and hostile getters.

This is an early independent part of EGO-111, not a monitoring/backup system.
Bounded API response metrics are described in [api-metrics.md](api-metrics.md).
External error tracking, release tagging, additional metrics/alerts, restore drills,
RPO/RTO, on-call and incident exercises remain separate work. No retention or
legal policy is selected here; no domain/payment/schema mutation is introduced.

References: [Pino log hooks and serializers](https://github.com/pinojs/pino/blob/main/docs/api.md)
and [Fastify logging](https://fastify.dev/docs/latest/Reference/Logging/).

API access logs retain method, server route template, request correlation and
response status. They do not serialize the raw URL/path/query, client Host or
remote IP address. Unknown routes use a fixed unmatched marker. This prevents
subject IDs, caller-supplied path secrets and client addressing from entering the
default request log. Internal runtime/PID/host and bounded job diagnostics still
require operator access control and a retention policy; aggregate metrics and
privacy/legal acceptance remain separate concerns.
