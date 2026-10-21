# Worker failure diagnostics (EGO-158)

Caught worker failures now emit one JSON record per existing failure path.
`runtime=worker`, numeric `level`, ISO `time`, a fixed `event`/`msg` and bounded
`err` metadata let operators distinguish a connection failure from image
validation without exposing raw exception text.

Events and severity:

- `WORKER_POLL_FAILED` (50): claim/abandoned-upload polling failed.
- `NOTIFICATION_POLL_FAILED` (50): notification cycle failed.
- `OAUTH_ATTEMPT_CLEANUP_FAILED` (50): bounded OAuth cleanup failed.
- `AUTOGRAPH_PARTIAL_CLEANUP_FAILED` (40): attempted partial-PUT cleanup failed.
- `AUTOGRAPH_FAILURE_RECORD_FAILED` (50): the job failure could not be persisted.
- `AUTOGRAPH_PROCESSING_FAILED` (40): an image/storage/DB processing attempt failed.

Processing records retain only a valid internal UUIDv4 `jobId` and a finite
`reason` where available. Reasons are the existing image rejection codes,
`STORAGE_FAILURE` and `PROCESSING_FAILURE`; they do not authorize retries or
change job state. `err` uses EGO-139's existing allowlisted names/system/SQL codes
and numeric status. Unknown metadata and hostile getters are discarded.
Messages, stack/cause, arbitrary fields, original/cleaned storage keys, signed
URLs, cookies and provider payloads never enter these records. Log collection
still needs access controls: internal job IDs are operational correlation data.

Scheduling, retry/lease/failure decisions, partial-object cleanup, OAuth cleanup
pacing, notification ambiguity handling and shutdown remain unchanged. A DB
failure after successful PUT still preserves the private object for adoption by
the existing retry. Startup/shutdown diagnostics and successful OAuth cleanup
records retain their existing contracts.

This supplies structured facts, not delivery guarantees, external error
tracking, metrics, alert rules, retention, on-call or backup/restore acceptance.
No monitoring provider or privacy policy is selected. Operators must verify
ingestion and alerts separately under EGO-111 before pilot acceptance.
