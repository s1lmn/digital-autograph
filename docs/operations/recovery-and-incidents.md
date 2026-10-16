# Recovery and incident response — EGO-161 / EGO-111

Status 2026-10-16: **preparation, not operational acceptance**. The owner has not
chosen a real restore environment, alert channel or on-call person. No backup
schedule, provider error tracker, paging route, production restore or tabletop
has been installed/performed by this change. Never substitute CI fixtures for
these gates or mark EGO-111 Done from this document.

## Isolated executable drill

```sh
# PostgreSQL only: Docker required; no application configuration is consumed.
node scripts/smoke-recovery-drill.mjs

# Full CI drill: Docker plus isolated loopback MinIO and APP_ENV=test required.
pnpm test:recovery-drill
```

The PostgreSQL tool creates a unique internal Docker network and two fresh
PostgreSQL 17 containers with temporary in-memory data and no host ports,
host-directory mounts, production URL, application image or worker. It applies
the actual committed migrations, seeds a synthetic fulfilled financial chain,
uses custom-format pg_dump and single-transaction pg_restore, compares restored
rows and source fingerprints, then exercises restored FK, active-placement
uniqueness, immutable earnings and immutable Order amount guards. It removes
only containers/network that it successfully created. Failure and cleanup failure
return nonzero with fixed redacted events. No dump/data/SQL is printed or uploaded
as an artifact. A killed process/host may leave its uniquely named disposable
resources; inspect ownership before operator cleanup.

The private-object drill requires the literal loopback address 127.0.0.1, an
explicit HTTP port and test environment. It creates fresh source/backup/restore
buckets with synthetic random bytes only, writes a private temporary archive,
checks SHA-256 before restoration, restores through the backup bucket, verifies
source/restored bytes and denies unsigned reads on all three. It cleans up only
its own keys/buckets and private temporary directory. It cannot select an
existing bucket or accept a production endpoint/real original. These guards
reduce accidental targeting; use a disposable local MinIO, never a production
storage tunnel. PostgreSQL and object drills are separate roundtrips, not an
atomic cross-system recovery point.

CI runs both checks after the regular integration suite. The emitted durations
measure tiny fixtures on that runner. They are **not** the application's RPO/RTO,
production data completeness, PITR, off-host survival or restored service capacity.
creator_earnings is the current append-only earning evidence; the future full
ledger from EGO-103 does not exist here and is not claimed verified.

## Real backup activation checklist

Assign an infrastructure owner before enabling a schedule. Record the chosen
environment, data scope, approved retention, access policy and evidence location
privately. Separate application/runtime credentials from backup/restore operators.
Do not grant public access to originals or use public Git, CI artifacts, developer
Downloads folders or shared chat attachments for archives.

For staging PostgreSQL, a local archive on the same VM/disk is not disaster
recovery. Configure encrypted off-host backup storage with separate restricted
credentials and key recovery. A schedule must detect missing, late, failed and
unverified runs; its monitoring cannot depend solely on the source VM. Capture
server/tool versions, archive integrity, start/end timestamps, source recovery
point and completion evidence. Verify the PostgreSQL client/server compatibility
before automation. For production, retain the existing Managed PostgreSQL/PITR
design and verify provider backup settings, restore permissions and a real restore;
do not replace it with the tiny CI tool.

For Object Storage, determine the actual provider's versioning/backup/replication
capabilities and configure a private, independently protected backup destination.
Protect older recovery points from the same credential that can delete live data.
A mirror that propagates deletion is not sufficient protection. Record which
object versions correspond to a DB recovery point and how missing/deleted/changed
objects are reconciled. The repository does not yet record a backup version ID
for every Asset: no atomic DB/S3 snapshot is promised. Require a verified coherent
recovery procedure before accepting the combined backup.

Retention is a privacy decision under EGO-74/110. Define backup expiry and handling
of user deletion/tombstones before activation; restoring must not republish data
deleted since the recovery point. Keep deletion evidence and apply it before
opening any restored service. Do not invent a retention duration in a script.
Schedule installation, IAM changes, object versioning/replication and deletion of
old archives are infrastructure changes, separate from this uninstalled drill.

## Real restore sequence

1. Incident commander authorizes the recovery point and an isolated target.
   Record the exact source/target identities privately and have another operator
   verify the target is fresh, empty and outside the live application's network.
2. Preserve the source and available evidence. Do not run volume prune, drop a
   live database, overwrite the original bucket or restore over the only copy.
3. Deny public ingress and outbound payment/provider callbacks, notifications,
   analytics and worker activity. Existing incident switches stop only new
   admission: they do **not** stop callbacks, reconciliation or notification
   workers, and are not sufficient network isolation for a restored copy.
4. Verify archive origin/integrity and tool/schema versions. A PostgreSQL dump can
   execute database code during restoration: accept only the approved trusted
   backup, even when a checksum matches. Use an isolated least-privilege context.
5. Restore PostgreSQL and matching private object versions. Validate actual
   schema/migration history, FK/unique/check constraints, immutable histories,
   one active placement per slot, one payment per Order and one takeover per
   fulfilled Order, exact integer amounts/currency/share and earning links.
   Query counts/totals without publishing rows/IDs. Verify object hashes, private
   access and approval/moderation relationships against the recovered DB.
6. Resolve deletion/tombstone, pending/unknown payment, outbox and provider
   reconciliation differences through the approved recovery process. Never replay
   a payment or ambiguous Telegram send merely because a backup is older.
   Retain financial history; use compensating corrections, not rewritten rows.
7. Measure until a consistent read-only service is usable, then separately record
   full safe-operation restoration. Record unavailable data and gaps. Keep runtime
   outbound operations blocked until the payment/privacy owners approve recovery.
8. A second operator verifies evidence and the commander authorizes any traffic
   cutover. Keep the former source recoverable and document a rollback plan.

This document is a procedure, not permission to modify a particular environment.
The isolated script intentionally has no real-target restoration option.

## RPO/RTO and evidence

Actual staging/production RPO and RTO are **unknown/unmeasured**. Targets require
an owner and a business decision; fixture milliseconds must not fill these fields.

RPO observation: latest trustworthy recovered committed-data time compared with
the declared incident/reference time, plus object consistency and any gaps.
RTO observation: incident/recovery start to verified service restoration. Record
restore command time separately from validation, provider reconciliation and safe
traffic reopening; those can dominate recovery. A backup age is not proof that
all data at that timestamp is recoverable.

Copy the [blank acceptance record](reliability-acceptance.template.md) into the
agreed private evidence location for each real drill. Include failures and
unverified checks. Fill no fields from assumption and do not commit participant,
operator contact, account/financial rows or real archive paths in public Git.

## Severity and contact tree — proposed, unassigned

SEV1: suspected private-original/data exposure, financial inconsistency/double
fulfillment or widespread auth/payment/DB/storage outage during a Drop. Stop
expanding impact immediately; preserve recovery and history where safe.

SEV2: partial outage/degradation, growing processing/reconciliation/moderation
backlog, capacity exhaustion without confirmed integrity loss. Investigate and
reduce noncritical load; escalate to SEV1 on spread or integrity/privacy risk.

SEV3: contained defect with a safe workaround and no active privacy/money risk.
Record and schedule a fix; reevaluate severity when evidence changes.

Roles needing named people: incident commander/backup, engineering on-call/backup,
payments/finance owner, privacy/security owner, moderation lead and creator/support
communications owner. Choose primary/backup contact methods and acknowledgement/
escalation timing before the pilot. Until assigned, the contact tree and incident
response acceptance are incomplete. The agent is not silently assigned on-call.

## First actions by incident type

- **Payments / paid-not-fulfilled:** freeze new paid admission using
  [incident controls](incident-controls.md) on every API instance, preserve
  callbacks/recovery only where safe, and engage the payment owner. Check persisted
  evidence against provider observations with existing reconciliation tooling.
  Never create a new payment, manually mark success or retry ambiguous outcomes
  as a substitute for reconciliation. Claims can remain available if independently
  safe; a privacy/integrity incident may require broader containment.
- **Suspected data leak:** preserve minimal restricted evidence, contain affected
  access, engage privacy/security owners, and rotate affected credentials through
  their operator procedure. Do not attach originals, signed URLs, logs with tokens
  or personal data to public issues. Legal notifications require their owner.
- **Auth outage:** separate API/session failure from a specific identity provider,
  inspect bounded release-correlated errors and callback metrics, keep existing
  sessions/history available where safe. Never bypass signature/state/cookie checks
  or manufacture identity/consent to restore sign-in.
- **Drop overload:** inspect host/disk, DB connections/locks, queue age, read and
  mutation latency; stop noncritical work before correctness-critical recovery.
  Use the [capacity runbook](staging-capacity.md), avoid destructive emergency
  pruning and do not disable reservation locks/idempotency or moderation checks.
- **Moderation emergency:** engage moderation lead, identify affected approved
  administrative actions, contain visibility with actor/reason/audit evidence.
  Preserve originals privately and an appeal path. EGO-134's reports/case queue
  are not yet delivered; do not invent a functioning reporting/urgent-SLA system.

Record incident start, severity/reason, observed deployed SHA, evidence, actions,
actor and time, decisions, affected capability, recovery verification and remaining
risk. The commander owns status updates; no automatic message is sent by this PR.

## Tabletop exercise plan — not yet conducted

After named roles, telemetry delivery and staging recovery exist, rehearse:
one paid-not-fulfilled signal during a Drop, simultaneous storage outage, then
discovery that an older backup contains a subsequently deleted Asset. Ask who
acknowledges/escalates; which admission is disabled; what still runs; which target
is safe; how provider/outbox/deletion evidence is reconciled; and who approves
reopening. Inject a missing collector sample and unavailable primary on-call.

Capture actual participants, timestamps, decisions, missed signals, unsafe steps,
follow-up owners and retest evidence in the private blank record. Passing a scripted
test is not this team exercise. A negative result blocks the relevant pilot gate;
do not edit the expected outcome to manufacture a pass.

## Primary references

- [PostgreSQL 17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html)
  describes consistent database dumps, archive formats and tool compatibility.
- [PostgreSQL 17 pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html)
  documents single-transaction/error handling, ownership/privilege options and
  trusted-dump requirements. The tool uses these against its own disposable DBs.
- [Yandex Managed PostgreSQL backups](https://yandex.cloud/en/docs/managed-postgresql/concepts/backup)
  and [Object Storage versioning](https://yandex.cloud/en/docs/storage/concepts/versioning)
  are provider references to verify when provisioning; this PR does not enable them.
