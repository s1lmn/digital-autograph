# Read-only operational snapshot — EGO-160 / EGO-111

This operator tool is early instrumentation, not an installed monitoring service.
It does not replace the API latency/error metrics or worker diagnostics prepared
in PR #64. No public HTTP route or runtime boot hook is added.

## Run

Use Node 24/pnpm and a separate operator environment, not browser variables.
Set `OPS_DATABASE_URL`, `OPS_S3_REGION`, `OPS_S3_BUCKET`, optionally
`OPS_S3_ENDPOINT` and the paired `OPS_S3_ACCESS_KEY_ID` / `OPS_S3_SECRET_ACCESS_KEY`.
The SDK can use its normal server credential provider when the pair is absent.
Use a private bucket and read-only bucket-access credentials. The command only
sends HeadBucket; it does not read original bytes, list keys, create buckets,
change ACL/policy or prove that public access is disabled.

For deployed databases use the deployment's TLS configuration and a credential
with SELECT on the application tables and normal statistics visibility. Do not
grant write access or statistics-superuser roles just for this tool. Set
`OPS_RELEASE_SHA` to the deployed full lowercase 40-character commit, not the
local checkout by assumption. Missing release is reported as null.

```sh
pnpm ops:snapshot
```

The command deliberately does not load `.env`; the operator supplies its own
private environment. Never paste configuration into tickets/logs. There is no
automatic scheduler installation, outbound alert delivery or default recipient.

Stdout is one JSON object with version, observation time, optional release,
numeric database aggregates, storage reachability and fixed alert codes. No
query text, usernames, IDs, URLs, credentials, object keys or exception messages
are emitted. A configuration/internal failure prints only `OPS_SNAPSHOT_FAILED`
to stderr. Exit 0 = observed fields below proposed thresholds; 2 = critical
alert; 3 = warnings only; 1 = collector/configuration failure. Exit 0 does not
certify the complete application or any unobserved dependency.

## Signals and limits

- DB connections: current database, including this one-connection probe. The
  denominator is the server-wide max_connections, not guaranteed available
  application capacity; other databases/reserved slots can exhaust it earlier.
- Long queries: active statements over 30 seconds belonging to the same DB role.
  SQL text is never selected. Other roles and cumulative slow-query analysis are
  outside this metric; it is not pg_stat_statements.
- Processing: ready queue count/oldest available age and failures in 15 minutes.
  Future retry delays are excluded from ready backlog. In-flight count, oldest
  claim age and claims older than the maximum supported worker lease are also
  observed (EGO-173). The maximum comes from the same `workerLeaseLimits` used by
  runtime configuration validation (currently 900 seconds); min/default/max are
  unchanged. A claim must be strictly older than that maximum to be counted.
  Future claim timestamps have zero age. Queued and terminal jobs are excluded
  from claim counts, and delayed retries remain outside the ready backlog.
  The actual per-process lease is not persisted: a configured 60-second lease can
  expire earlier than this conservative signal. Mixed releases/configurations
  require operator interpretation. This does not detect all expired leases,
  record lease reclamations, prove a worker heartbeat or authorize a retry.
- Payment: paid-not-fulfilled orders and pending/unknown reconciliation more
  than five minutes overdue. This is detection only: no payment retries,
  provider requests, state updates, refunds or notification sends.
- Moderation: awaiting_moderation count/oldest updated age. No report urgency,
  appeals or post-publication case SLA is inferred from this pre-publication queue.
- Storage: one bounded HeadBucket with an abort signal. Success means permission
  and reachability for that operation, not successful uploads/image processing.
- Original uploads (EGO-172): all reserved original Assets, including expired
  reservations still charged by admission; expired count and oldest expiry age.
  Completed originals and cleaned derivatives do not consume the pending count.
- Retired uploads: durable tombstone count, due count and oldest overdue age,
  using PostgreSQL time and each row's `next_check_at`. Future reservations or
  tombstone checks have zero overdue age. Counts/ages contain no keys or users.
  Read these against the deployed worker grace, reconciliation cadence and actual
  failures; age alone does not prove that a deletion is permitted or has failed.

The upload fields require the accepted A02 schema (migrations 0020/0021). An
older/missing schema or failed aggregate query reports the database observation
as unavailable, never zero usage. Grant the operator SELECT on the tombstone
table through the normal reviewed credential procedure; the tool grants nothing.

The pool has one connection, a three-second connection/statement timeout and
five-second client query timeout. PostgreSQL sessions default to read-only;
all collection is a single SELECT over a statement-consistent snapshot. Avoid
high-frequency probes: aggregate scans can time out as volume grows. A timeout
is an unavailable observation, never a fabricated zero. No schema/index change
or business-path dependency is introduced.

## Proposed alert policy, not accepted SLOs

Any unavailable DB/storage observation or paid-not-fulfilled order is critical.
`ORIGINAL_UPLOAD_CAPACITY_EXHAUSTED` is critical when persisted reserved originals
reach the existing backend global pending cap (currently 300).
`ORIGINAL_UPLOAD_KEY_BUDGET_EXHAUSTED` is critical when pending originals plus
retired tombstones reach the backend key budget (currently 10000). These signals
reuse `autographResourceLimits`; they detect refused new-upload admission, not
payment failure. Expired reservations stay charged until successful cleanup.
No new upload/cleanup/retention policy or age-based SLO is introduced. Investigate
worker health and provider failures; do not delete tombstones, reset attempts,
raise caps or retry financial operations to silence an alert. Reconciliation and
any retention change follow the existing reviewed upload/privacy procedures.
Warnings: connection count at 80% of server limit, any same-role query over 30s,
ready processing age at 300s, any processing failure in 15m, overdue payment
reconciliation, or moderation age at 3600s. These are conservative starting
signals requiring owner/SLO review and tuning with pilot observations.

Before activation, an operator must choose a private monitoring runner, frequency
(a proposed starting point is 60 seconds), alert destination, recipient/on-call,
deduplication by code/environment and recovery/stale-sample handling. Route exit
1 and missing/stale samples to a collector-failure alarm; do not treat absent
JSON as recovery. Preserve each critical signal even if warning suppression is
enabled. Run once per environment and monitor the scheduler independently.
Store output privately with agreed retention; aggregates are not public analytics.

`PROCESSING_CLAIMS_PAST_MAX_LEASE` is a warning when at least one persisted
processing claim is older than the supported maximum lease. It uses the worker's
existing reclaim boundary, not a new processing SLA. Investigate worker failures
and storage/database latency using private diagnostics; do not reset job state,
attempts or lease tokens to silence it. Normal fenced worker recovery remains
responsible for processing. No claims or retries are performed by this reader.

The portable CLI regression uses refused loopback connections and asserts real
critical output/exit status with zero credential leakage. PostgreSQL/MinIO
integration verifies a real queue observation, unchanged rows and missing-bucket
failure. These tests do not prove alert delivery to people.

## EGO-111 acceptance still required

Auth-provider outage, webhook failure rates, API percentiles, worker heartbeat,
host CPU/memory/disk and release-correlated error tracking need their own
instrumentation and an installed collector. A successful snapshot does not cover
them. Existing incident admission switches are documented in
[incident-controls.md](incident-controls.md); this tool never flips them.
Backups, isolated restore, measured RPO/RTO, an actual recipient and tabletop
exercise remain separate acceptance gates. As of 2026-10-16 the owner has not
chosen the environment, alert channel or on-call person.

PostgreSQL statistics visibility follows the official
[monitoring documentation](https://www.postgresql.org/docs/17/monitoring-stats.html).
Storage probe behavior follows the official
[S3 HeadBucket API](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadBucket.html).
