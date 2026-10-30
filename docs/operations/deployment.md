# Manual deployment on the existing single VM

The supported path is manual SSH with the existing Docker Compose project.
**Release stays disabled. Never restore the old GitHub runner or its sudo/Docker
access.** The old SHA-only `deploy-on-vm.sh SHA` and `rollback` entrypoints now
refuse before doing work. No new VM, cloud lab, registry, service account, paid
service, workflow or runner is required. Two competent maintainers review and
operate this change; no third reviewer is required for ordinary code review.

Keep the existing private S3 bucket as the file store, including all old objects.
Moving files to a different backend is not part of this update. Web, API, Worker,
PostgreSQL and Caddy continue on the same VM. Existing storage/snapshot charges
continue; no additional fixed monthly resource is introduced.

## Before the owner authorizes a server change

1. Merge one independently reviewed PR through existing protected checks. Keep
   A02/A03 and migrations 0000–0023 unchanged. Record the resulting accepted main
   SHA; do not label an image with another checkout's SHA.
2. Run unit tests, real local PostgreSQL/MinIO integrations and recovery drill.
   `restricted-runtime.test.ts` upgrades a separate local populated 0016 DB as a
   non-superuser migrator, exercises restricted API/worker paths, concurrent Free
   Claim, denied privileges, and the actual dump/file restore command. These are
   synthetic compatibility results, not physical site acceptance.
3. On a trusted workstation, prepare a private site JSON with `operation` (unique
   lowercase ID), `instanceId`, `runtimeServiceAccountId`, the two existing
   `runtimeSecretIds`, `effectiveAuthorityReviewedBy`, `database`, `domains.web`,
   `domains.api`, `caddyConfig: "Caddyfile"`, `publicDomainApproved: false`,
   `drainSeconds: 330` or greater, and `infrastructure.postgres/caddy` immutable
   image IDs from read-only inventory. Use the existing staging origins first.
4. Build once from a **clean exact reviewed checkout**, outside the VM:

   ```sh
   node scripts/prepare-manual-release.mjs FULL_MAIN_SHA /private/offline-release /private/site.json
   ```

   This uses the local Docker builder, linux/amd64, and `docker save`; it does not
   publish anything. Four archives, their SHA256, immutable Docker config IDs,
   source revision labels, 24 migration SQL hashes and the deploy-tool bundle
   hash are recorded in `manifest.json`. Tags alone are never trusted. Build
   inputs/context must not contain secrets. Keep artifacts outside the checkout.

5. Obtain one exact owner permission naming VM, operation, accepted SHA/image
   IDs/tool hash, downtime, backup location/data recipients, two maintainers and
   the changes below. No actual server changes have been authorized merely by
   preparing this runbook or PR.

## Approved maintenance window

Use the already trusted operator SSH key and strict host-key checking. Preserve
all old backups, snapshot, runner forensic evidence and volumes. Do not run
volume/image prune, `down -v`, backup rotation or old retention helpers.

Install only the reviewed source/artifact files and prepare the new private env
set, then run `prepare` below. These staging/capacity operations do not change DB
ownership/schema or replace running images. Freeze, final backup and off-VM
restore proof come **before** metadata/IAM changes and `apply`. Keep writers
stopped throughout the checkpoint. If backup/restore fails, do not change
credentials, VM options, IAM, ownership or schema.

### Install reviewed files and prepare separate credentials

After permission, transfer the exact tool bundle and archives over SSH to root-
owned `/opt/digital-autograph/` and `incoming/OPERATION/`. Public source tools are
root-owned and not writable by another user; private manifests/archives/envs are
0600, directories0700. Match `toolBundleSha256` against the approved source.
Ensure installed Compose supports `!override` (existing observed2.40.3 does).
Do not replace `/etc/digital-autograph/env/postgres.env`: it remains the existing
sealed bootstrap/operator login. Do not derive it from an application DSN.

```sh
sudo node /opt/digital-autograph/manual-env.mjs /opt/digital-autograph/incoming/OPERATION/manifest.json
```

This copies existing API/worker configuration privately, strips old DB URLs and
YooKassa keys, generates three distinct random passwords, and writes separate
API/worker/migration env files. It does not change PostgreSQL. API/worker keep
only their runtime env; migrator gets only its DB URL. The existing bootstrap
credential is never copied into these files. Domains/callback URLs follow the
approved manifest; first use the currently registered staging origins.

Compose forces `DISABLE_NEW_PAYMENTS=true`; the prepared free path uses
`DISABLE_FREE_CLAIMS=false` and
explicit storage credentials; test auth is prohibited. Existing incident.env is
retained: an active Free Claim freeze fails preflight instead of being silently
cleared. Base Compose also requires immutable IDs and the versioned runtime env
directory, so an old release.env cannot accidentally start incompatible images. No legal registry flag,
production pricing, decay or YooKassa/live payment is enabled.

### Phase 1 — freeze and final database backup

```sh
sudo /opt/digital-autograph/deploy-on-vm.sh --manual prepare /opt/digital-autograph/incoming/OPERATION/manifest.json
```

Preflight validates the manifest/proofs/config, >=7GiB and200k free inodes,
archive checksums, source labels, amd64 immutable images and existing PG/Caddy
image IDs. It never prunes data. It disables restart on **old API/worker only**,
stops them gracefully, waits at least the actual old upload TTL+approved skew,
and checks no other DB client sessions remain. Then it writes a binary custom
`database.dump`, migration/row-count baseline and durable `BACKUP_REQUIRED`
receipt under `/var/lib/digital-autograph/manual/OPERATION/`.

Confirm the old configured upload TTL really fits the manifest's drain bound
(the last observed value was300seconds). Expiration does not cancel an already
accepted remote PUT. File inventory stability is checked, late/unknown originals
must remain preserved/tracked, and no source objects are deleted during backup.
If storage is still changing, preserve the partial archive, extend the reviewed
bounded drain and take a fresh checkpoint; do not claim a consistent backup.

Web may serve an error while API is stopped. This planned downtime also covers
the restore rehearsal. There is no automated restart of the old writers. If SSH
is lost, inspect the durable stage and container state with a fresh connection;
never replay an unknown phase or assume a successful deployment.

### Phase 2 — prove recovery off the VM

Copy the dump, operation `state.json` and required protected file-backup input to
the existing trusted workstation, without printing payloads into the terminal or
chat. Backups may contain personal/session data: exact recipient, encrypted-at-
rest location and retention must be included in owner permission. No third party
or new cloud storage is required.

With existing S3 configuration supplied privately in the process environment:

```sh
pnpm exec tsx scripts/backup-files.mts snapshot /private/files-backup MAX_TOTAL_BYTES
pnpm exec tsx scripts/backup-files.mts verify /private/files-backup
```

The snapshot lists/GETs the existing bucket, conditional on each ETag, hashes the
actual bytes, rechecks inventory and writes opaque local filenames0600. It never
writes/deletes in the source. Changing/incomplete data or a budget failure blocks
promotion. The archive's `manifest.json` includes source endpoint/bucket and is
private; do not publish object keys.

Prepare a protected restore config with a **local immutable PostgreSQL17 image
ID**, a loopback-only MinIO endpoint (`http://127.0.0.1:PORT`), its synthetic local
credentials, and the actual second maintainer's `reviewedBy`. Then:

```sh
pnpm exec tsx scripts/verify-manual-backup.mts /private/state.json /private/database.dump /private/files-backup /private/local-restore.json /private/recovery-proof.json
```

This restores the actual DB archive in a fresh local Docker volume/container with
no network, checks all baseline migration hashes/table counts, restores the actual
backed-up files into a fresh private **loopback** MinIO bucket and verifies bytes.
It removes only its own temporary restore resources. Unknown schema/functions
in an old archive remain untrusted input; no host mounts, sockets or outbound
network are allowed in that PostgreSQL container. No restore touches the server
or source bucket. Retain the original archives and evidence.

Copy `recovery-proof.json` and the file archive's `manifest.json` (as
`files-manifest.json`) owner-only into the server's operation directory. They
must match the exact DB archive, baseline, source S3 endpoint/bucket and reviewed
operator state. A human name is an attestation, not an automatic independent
review. The second maintainer actually inspects/reproduces the result.

### Security change — only after Phase 2 recovery proof

The new deployment does not fetch Lockbox or registry credentials on the VM.
Runtime still uses its existing explicit static S3 pair. After the quiesced final
recovery checkpoint and off-VM restore proof, the owner/provisioner on the workstation changes **only**:

```sh
yc compute instance update "$EXISTING_VM_ID" --metadata-options aws-v1-http-token=disabled,aws-v2-http-token=disabled,gce-http-token=disabled
# Repeat for exactly the existing API and worker secret, with reviewed IDs:
yc lockbox secret remove-access-binding --id "$EXISTING_SECRET_ID" --role lockbox.payloadViewer --service-account-id "$EXISTING_RUNTIME_SA_ID"
```

These commands require the owner's explicit permission; they are not executed by
any source script. Verify the command/schema against the installed `yc` version
before the window. Endpoints and SSH/firewall rules are otherwise unchanged.
Do not use the withdrawn M01 v1, a new firewall rule, or a token-endpoint probe.
Disabling credential issuance is not a claim that the metadata directory itself
is unreachable. Removing both Lockbox bindings also addresses already issued
runtime tokens; allow IAM propagation and review inherited/group authority. Do
not infer absence of historical disclosure or compromise from this change.

Capture read-only evidence on the workstation:

```sh
node scripts/capture-runtime-authority.mjs /private/site.json /private/metadata-proof.json
```

Only VM options and access bindings are read; no payloads, token endpoints or
secret metadata entry names. The proof must show all three token settings
`DISABLED`, no runtime-SA bindings on either secret, and a named inherited-access
review. Its SHA256 is recorded in the operation receipt. Keep proof/site/manifest owner-only.
A setting/grant regression blocks apply/start. Do not restore an exposed
key or automatically re-enable credential issuance as recovery.

### Phase 3 — authority proof, roles/migrations, then restricted startup

```sh
sudo /opt/digital-autograph/deploy-on-vm.sh --manual apply /opt/digital-autograph/incoming/OPERATION/manifest.json
sudo /opt/digital-autograph/deploy-on-vm.sh --manual start /opt/digital-autograph/incoming/OPERATION/manifest.json
```

`apply` first requires the security changes and fresh proof described above.
It rechecks the frozen baseline and recovery proof before writes. The sealed
operator creates `da_api/da_worker` non-owner runtime roles and a separate
`da_migrator` object owner, all NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION/
NOBYPASSRLS without memberships. PostgreSQL gets SCRAM verifiers, not plaintext
passwords in SQL. The migrator alone runs0017–0023; the operator then applies the
explicit runtime table/column/sequence grants. Default PUBLIC TEMP/CREATE and
PUBLIC function execution are restricted. Runtime cannot grant admin, DDL,
TRUNCATE, rewrite append-only evidence, or use the migration credential.

Worker intentionally has column UPDATE(web) on notification_preferences and
UPDATE(consumed_at) on oauth_login_attempts to permit PostgreSQL row locks; these
are real bounded extra capabilities, reviewed with the SQL. It cannot read/write
financial tables. The original bootstrap privileges are preserved for recovery;
they are not returned to API/worker.

Only all24exact migration receipts allow `MIGRATED`. `start` requires that receipt,
unchanged config and proof, uses the exact loaded immutable IDs with `--pull
never`, waits for app health, verifies actual API/worker identities, recreates
Caddy using its existing cert volumes, then checks public Web/API health. New
containers regain normal `unless-stopped` behavior. No auto-fallback uses a cached
old image; the previous6847339/14cbe16 images are incompatible with schema0023.

Failure/unknown COMMIT is `STOPPED`: writers stay down, backups/DB/files preserved.
Inspect receipts/schema with read-only SQL. Prefer a reviewed compatible forward
fix. Any whole-DB restore requires a separate recovery decision covering writes
since the checkpoint; never automatically replay a charge or discard history.
Before schema writes, restarting the exact old containers is a distinct operator
recovery action; after ownership/DDL changes do not assume it is safe. No stage
claims success solely from a healthy old container. After startup, the accepted
A03 worker performs its normal lease/recovery and lifecycle cleanup; the approved
window must cover that behavior. All old file bytes are backed up first; no
operator data/volume/evidence pruning is included.

## Physical staging acceptance, then domain permission

The three mandatory live gates are: the actual checkpoint's recovery proof,
exact24migration receipts/restricted identities, and a **real** approved actor's
login→autograph→processing→approval→moderation→FreeClaim→history. Include Wall
lifecycle/retry, private-original denial, creator/moderator permissions and worker
recovery. Existing test seams/mocks/local proofs do not satisfy physical OAuth or
mobile acceptance. Google/Telegram callback registrations need matching origins;
resolve the observed Telegram auth error privately, never by printing credentials.

After these gates, obtain separate DNS permission. Prepare A records for
`destka.ru`, `www.destka.ru` and `api.destka.ru` pointing to the **same existing VM**,
check AAAA/CAA/old records, DNS TTL, cert issuance and rollback record set. No
record changes are performed by this PR. A new approved manifest selects
`Caddyfile.destka`, `domains.web=destka.ru`, `domains.api=api.destka.ru` and
`publicDomainApproved=true`. It provides HTTPS and permanent
`www.destka.ru{uri}→https://destka.ru{uri}`; Caddy handles HTTP→HTTPS. Update the
existing OAuth registrations to exact `https://api.destka.ru/auth/PROVIDER/callback`
and runtime Web/CORS origins together under that permission. `manual-env.mjs`
sets the corresponding private values; Web uses the approved API origin.

Website/Merchant acceptance remains open until actual privacy/OAuth/mobile/legal
checks. Keep unapproved legal documents unpublished and all paid operations off.
Prices stay89RUB minimum,+100 per successful takeover,cap4989,900s protection,
creator50%. No YooKassa activation or merchant submission is included.

Preserve the paid recovery snapshot and root-only historical runner evidence.
Closing runtime credential paths is not a forensic declaration that the old host
was never compromised; both maintainers/owner explicitly review that residual
risk before public launch. No additional security lab or third ordinary reviewer
is required by this manual path.
