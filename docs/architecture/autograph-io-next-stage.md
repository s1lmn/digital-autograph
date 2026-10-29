# A03: Short transactions around private storage I/O

Prepared after A02 (EGO-109 / EGO-113); implementation is a separate dependent PR
from accepted A02 main. This document is a design checkpoint, not implemented code.

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
