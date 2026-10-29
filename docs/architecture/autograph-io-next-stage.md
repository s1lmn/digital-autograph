# A03: Short transactions around private storage I/O

Implementation candidate under EGO-109, based on accepted A02 and green main
`375ab3a4d321a164bb58545129282cef486138a2`. Independent review, exact-head CI,
protected merge and green main are required before A03 acceptance. Not deployed.

## Candidate protocol

Original upload/completion commit a short authorized claim, release the connection,
perform bounded I/O, then re-lock the Autograph and verify the exact Asset/key and
unexpired operation token. Four durable `autograph_storage_leases` slots replace
transaction-held original permits; a fifth retains single-cleaner admission.
The immutable key is exclusive across upload/completion/cleanup. Same-key
contention waits at most two seconds without a connection; global refusal stays 429. Attempts, quotas, reservation expiry and conditional original PUT are unchanged.

Leases last60s using PostgreSQL time. Original callback work has a40s ceiling,
cleanup15s; actual S3 PUT/HEAD/delete and cleaned PUT have a total10s adapter
budget, including ignored middleware/credential cancellation. Private GET/body
retains the accepted30s helper unchanged. A reclaimed lease cannot cancel an
already accepted remote write; late keys stay tracked. These are engineering
budgets, not target-provider/capacity/mobile acceptance.

Cleanup permanently retires an expired generation before external DELETE. It
releases quota only when a fenced final transaction moves the key to the existing
tombstone table, removes the reservation and restores draft. Failure/restart keeps
the retired row charged. Fresh reservations use new UUIDs/keys. Tombstones retain
the one-hour backoff and are never discarded after DELETE. Metadata rejection
no longer deletes immediately: an old HEAD cannot authorize a stale DELETE.
Invalid private bytes remain charged until expiry cleanup and cannot authorize
processing/placement.

Processing output keys include job ID and claim token. Claim records
`autograph_processing_artifacts` before PUT; adoption is atomic with cleaned
Asset/job success. Conditional PUT prevents overwrite. Partial cleanup retires
only its attempt before DELETE; stale workers cannot delete a successor's output.
Unadopted keys survive failures/restarts and are repeatedly reconciled; adopted
keys are excluded. At most three records per new job use its existing attempt
bound. Migration0022 preserves one legacy deterministic key per existing job,
marking referenced outputs adopted and unknown outputs retired. It changes no
original tombstone cap, TTL/retention policy or financial writer.

Lost COMMIT responses discard the connection. Claims proceed only after a fresh
read proves their durable token; finalization checks an Asset receipt, adopted
artifact or tombstone. Unproven outcomes raise fixed `StorageCommitUnknownError`.
No mutation replay or inferred rollback/deletion. Ordinary read/retry/reconciliation
resolves remaining state. PR81 safe diagnostics and its allowlist are unchanged.

The shared runtime pool uses acquisition3s, lock5s, statement10s, query12s and
idle-in-transaction15s. Explicit server startup settings prevent DSN/PGOPTIONS
timeout overrides; other URL/SSL fields remain. The lock budget accommodates the
existing real three-second financial contention tests; quota admission retains
SET LOCAL2s. Server cancellation precedes client timeout. Storage transactions
discard failed/ambiguous clients; financial state machines keep their UNKNOWN rules.

## Rollout and rollback gates

Migration0022 is additive. Verify clean/repeated and populated A02 upgrades,
including legacy processing artifacts. Drain **every old API/worker writer**
before enabling this protocol: old code does not understand durable fences.
Keep originals, backup/evidence and tombstones. Do not mix old writer versions or
blindly roll back to A02. Use a separately reviewed compatible image, or stop
writers and forward-fix/reconcile. Never drop receipts, retired flags or artifact
evidence. A01/owner deployment authorization and independent operational acceptance
remain separate; no staging migration/deployment is authorized by this PR.

## Original design checkpoint (historical)

## Confirmed remaining problem

Autograph completion/cleanup and A02 byte ingestion hold a PostgreSQL transaction
and Autograph row lock across external I/O. A02 bounds incoming byte memory and
PUT/HEAD/delete time and shared I/O concurrency; it does not remove this coupling.
The shared Pool still uses default connection/query/statement timeouts.
Accepted PR81 now provides safe allowlisted idle diagnostics; accepted PR82
provides the private GET/header/body overall deadline and recovery tests. Financial repositories have independent lock/idempotency rules
which must not be rewritten as a side effect.

## Accepted prerequisites — 29 October 2026

Main `90341e404aa87e10fc18626322bd5a30d7d743f5` includes PR81/82 and has green
post-merge CI/Secret Scan. A02 merges these changes normally: preserve bounded
conditional PUT, HEAD/delete deadlines and `readPrivateObject` GET handling.
A03 must reuse these accepted helpers/tests. They do not provide the remaining
lease/fencing protocol or finite PostgreSQL acquisition/query deadlines.
The A02 protected merge and new green main remain the start gate for full A03.

## Sequence

1. Add original-operation generation/lease fields and bounded global leases.
   Short transaction: authorize owner, lock Autograph then Asset, recheck state,
   acquire operation lease using DB time and a random fencing token, commit.
2. Read bounded bytes/check private storage outside a transaction. Pass a single
   deadline AbortSignal through connect/request **and body reads**; cancel/destroy
   response streams on abort. SDK request timeout alone is not a body deadline.
3. Short final transaction: take the same locks in the same order, match Asset ID,
   immutable key/generation, lease token and unexpired DB lease, recheck source
   state and approval/moderation evidence, then update/enqueue idempotently. A
   stale completion must not enqueue or modify a newer reservation.
4. Cleanup first claims a fenced retired generation, commits, deletes externally,
   then finalizes only the matching generation. Never reuse retired keys. Keep A02
   tombstones: a database fence cannot cancel an already accepted remote PUT.
   Reconciliation must survive process crashes and late storage commits. Unknown
   DB commit results are resolved by persisted operation identity and state, not
   by assuming rollback or immediately deleting an object.
5. Configure finite Pool connection acquisition, server statement/lock/idle-in-
   transaction timeouts and compatible client query deadlines. Derive values from
   measured bounded operations; client deadlines should allow server cancellation
   to settle and discard unusable connections. Roll out separately with tests for
   cancellations, pool recovery and UNKNOWN financial outcomes. Never blindly
   retry payment/takeover transactions after a client timeout or commit ambiguity.
6. Retain PR81's observability allowlist/event code and its hostile-message
   canary regressions proving provider/DSN values cannot reach logs. Extend the
   same safe boundary to any newly introduced deadline diagnostics. Do not log keys, signed URLs, raw query text or payloads.

## Required verification before acceptance

Real PostgreSQL and isolated S3: concurrent finalization/cleanup; expired/reclaimed
lease; delayed HEAD/PUT/delete/body; stale workers; process exit between each step;
late provider writes after cleanup; failed deletion; commit acknowledgement loss;
no duplicate processing job; no resurrected keys or deletion of a fresh original.
Measure that no PG transaction/connection is held during storage latency and that
pool capacity remains available. Run existing payment UNKNOWN/late-success/retry,
reservation/takeover lock ordering, Free Claim, moderation and history suites.

Do not stack an independent A03 PR on unaccepted A02 source or declare this design
implemented. A02 review/merge and a refreshed green main are the continuation gate.
