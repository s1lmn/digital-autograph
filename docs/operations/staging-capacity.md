# Staging deployment capacity and image retention (EGO-142)

Staging release images accumulate on the VM unless explicitly retained. Builds
remain on GitHub-hosted runners. Never solve capacity with global Docker prune,
volume deletion, removal of application state/env files, or production changes.

## Incident evidence — 2026-10-07

Release `37630074418` for `de5b81ee44160a303151989770f1bb022bc502fa`
published successfully, but its runner failed with ENOSPC while writing `_diag`.
The migration image had not finished pulling. Current application containers
and recorded current tag remained `98ca1ef26e89645fefea12a1abea7abe350233f3`;
previous rollback tag remained `f7244e9b2dd45f746eb9d6d8fe5b3e78acd2cca3`.
The stale GitHub staging deployment `6911512084` was honestly marked failure:
`runner disk exhaustion / release did not complete`.

Read-only diagnosis after restoring temporary SSH access (one staging reboot):

| Consumer / capacity         | Before cleanup / resize    | After cleanup, before resize |
| --------------------------- | -------------------------- | ---------------------------- |
| Root filesystem total       | 25,303,613,440 bytes       | unchanged                    |
| Root used                   | 24,539,787,264 bytes (98%) | 16,487,583,744 bytes (66%)   |
| Root available              | 747,048,960 bytes          | 8,799,252,480 bytes          |
| Root free inodes            | 2,641,448 (18% used)       | 2,866,352 (11% used)         |
| Docker images               | 41 / 15.8 GB               | 21 / 7.746 GB                |
| Build cache                 | 0 bytes                    | unchanged                    |
| Active volumes              | 3 / ~50 MB                 | preserved                    |
| Runner `_diag`              | 4 MB / 27 logs             | preserved                    |
| Runner `_work`              | 8.7 MB                     | preserved                    |
| Runner installation         | 691 MB (597 MB externals)  | preserved                    |
| Journal / all `/var/log`    | 98.5 MB / 342 MB           | preserved                    |
| Backups / application state | 3 × 120,167 bytes / 376 KB | preserved                    |

`/var/lib/containerd` used 15 GB; Docker's configured `/var/lib/docker` used
only 50 MB. All required paths were on the root filesystem. Other top-level
usage: `/var` 16 GB, `/usr` 2.3 GB, `/home` 691 MB, `/opt` 184 MB, `/var/cache`
316 MB, plus the existing 4 GB swapfile. Old exact-SHA images, especially
migration images (~1.46 GB unique each), were the confirmed primary consumer.
No runner/cache/journal/backup cleanup was justified.

Emergency cleanup removed **only the four local project tags** (api, web,
worker, migration) for these five obsolete releases, stopping once available
capacity exceeded 8 GiB:

- `5a4e421522cb707f7a3be30d8d22bf9cff2b27c7`
- `d5872b5552d1810c8d03164e9ad9b76cdeda8517`
- `152d221b43171bbf8e8bf6bba092d182f1251bd0`
- `8d78cd9d169568a0e7daa60badfb9871a0c3b09b`
- `92e89d90e428b99834fdde17f0a178de018ab753`

This did not delete cloud registry tags, current/previous images, images used by
any container, third-party images, volumes, config/env files, objects or secrets.
The partial failed-release image pulls were also preserved. No force/prune was
used. PostgreSQL remained healthy with its named persistent volume, 15 journal
rows and 25 public tables. Three backups kept their names/timestamps/sizes/mode
600; all passed `pg_restore --list` with output suppressed:

- `20261004T181233-1872014.dump`
- `20261007T124642-3710957.dump`
- `20261007T131848-3727150.dump`

SSH recovery used only a temporary public key, preserving existing authorized
keys. Recovery user-data and temporary OS Login metadata were removed. Remove
the temporary guest key after technical verification. Do not put passwords or
private keys in metadata, reports, source control or runner diagnostics.

## Infrastructure resize — guest verified

The owner enlarged the staging boot disk to **53,687,091,200 bytes (50 GiB)**.
Read-only guest verification on 2026-10-07 confirmed `/dev/vda1` partition
**53,049,540,096 bytes**, expanded **ext4** filesystem total **51,304,554,496
bytes**, available **34,783,006,720 bytes**, free inodes **6,143,149**.
Containerd, runner home and application state all share this root filesystem.
No filesystem resize/format commands were performed. The preceding incident
and emergency-cleanup figures are historical **before resize**.

Premerge exact-head helper ran read-only through stdin: deploy required
7,516,192,768 bytes PASS; cached rollback required 268,435,456 bytes PASS;
inode threshold 200,000. The cached previous application/infrastructure set,
persistent PostgreSQL volume and three valid mode-600 backups were preserved.

## Recovery release authorization blocker

PR #37 merged as `dc89f8d12a73adf62c4f4640e7bf5d1ed5b4c7f8`. Main CI
37683301349 passed; automatic Release 37684119725 published all four images,
but failed at the first `sudo bash -c` preflight: the runner's old narrow
NOPASSWD allowlist did not permit it. The new combined helper install command
was also absent. Deployment 6920479555 is failure; the original failed
deployment remains historical failure. No config/env/pull/backup/migration/
retention mutation occurred; actual current remained `98ca1ef26e89645fefea12a1abea7abe350233f3`.
Post-failure root free was 34,765,287,424 bytes / 6,143,169 inodes. This is an
authorization-contract failure, not insufficient resized capacity.

Use the reviewed [runner authorization provisioning](runner-authorization.md)
with a fixed root-owned read-only entrypoint; no unrestricted sudo shell.
The Release workflow verifies that provisioned code matches the exact checkout
before running it and retains both operation-aware capacity guards.

## Fail-fast preflight

`deploy/host-capacity.mjs preflight <deploy|rollback> <state-dir> <release-dir> <registry-id> <staging|production>`
checks GNU `df` bytes and available inodes for release/state directories,
Docker's configured storage directory, `/var/lib/containerd`, and runner home.
For a not-yet-created directory, it checks its nearest existing parent. Errors,
malformed output, absent recorded images or unknown capacity fail closed.

For **deploy**, the minimum is **7 GiB available and 200,000 available inodes on every checked
filesystem**. The measured full image set totals ~2.92 GB. Two copies for
download/unpacking plus 1 GiB for backup/migration/transient logs need ~6.91 GB;
7 GiB provides rounding headroom. When the healthy image set grows, the byte
budget increases automatically to `2 × sum(image.Size) + 1 GiB`. This is a
capacity guard, not an estimate of exact shared-layer savings. Large DBs/backups,
changed Docker/containerd storage paths or larger runner installations require
reviewing this budget and mount coverage before deployment. The inode reserve
covers more than three observed release-set increments (~45,000 each).

For **cached manual rollback**, the minimum is **256 MiB** with the same
**200,000 free inode** guard on every checked filesystem. This reserves 64 MiB
for each of runner logs, container writable layers, Compose metadata and
release/state writes. Observed runner logs were 4 MB and state 376 KB; this
allows substantial transient-write headroom without charging recovery for
image download/unpack or backup/migration. It is not a guarantee against
unbounded application writes; monitoring remains required.

Rollback requires valid recorded current/previous SHAs and locally resolvable
previous **api/web/worker** references, plus `caddy:2.10.2-alpine` and (staging)
`postgres:17-alpine`. Docker inventory errors, missing references or invalid
image IDs fail closed before writes. Migration is profile-only and is not used
by manual rollback, so its absence must not block cached application recovery.
Retention still protects all four current/previous project targets and fails
closed with an operator warning if that larger protected inventory is missing.

Manual rollback reuses existing nonempty api/worker/postgres env files (no
Lockbox request), skips registry login/pull, and starts Compose with
`--pull never`. It requires the compatible existing runtime configuration;
expand/deploy/contract still applies. HTTPS health checks remain required, but
registry/cloud availability is not used as evidence of local image completeness.
A failed new deploy also restores its old application with `--pull never`.

The workflow passes the validated operation explicitly before installing release configuration. The deploy script
checks again before writing runtime env/release state, authenticating/pulling,
starting PostgreSQL, backup, migration or application replacement. Failed
preflight leaves current/previous tags, DB and application unchanged; it does
not try cleanup as a fallback or mask the failure. Capacity can still be
consumed by another process after the check; retain external monitoring/alerts.

## Post-success retention

After exact-image/health checks and current/previous tag recording, the deploy
script invokes `host-capacity.mjs retain`. It preserves complete current and
previous four-image sets and **image IDs used by every container, including
stopped containers**. Aliases of protected IDs are preserved. A missing
protected image set or unreadable/malformed inventory causes no deletion.

Only this registry's `digital-autograph/{api,web,worker,migration}:<40-hex-SHA>`
obsolete local tags are eligible. Untag individually without force, rechecking
tag state and container/image inventory before each deletion. Never delete by
image ID, containers, volumes, third-party images, dangling/untagged images,
build cache or cloud objects. Retention is local to this VM and does not alter
immutable registry publication policy.

Failed pull/backup/migration/startup/readiness and automatic rollback failure
never invoke retention. Manual rollback retains the same two release sets.
A post-success retention error is an explicit operator warning; it cannot
undo the successful application or turn an earlier failed deployment green.
Inspect capacity before allowing the next integration release.

Inventory/capacity subprocesses retain a 30-second timeout. Each separately
guarded `docker image rm` has a bounded five-minute timeout: unpacked migration
image deletion on the staging HDD exceeded 30 seconds in Release 37772014942,
causing client cancellation (Docker HTTP 499) and incomplete retention after
successful deployment. No force/prune or retry is added. A timeout/nonzero exit
stops further removals and reports only the operation and timeout/exit status,
never raw command output or environment values. Check remaining candidates and
protected image sets read-only before any subsequent operator action.

This helper change requires independent approval and administrator provisioning
from the accepted exact root-owned checkout per `runner-authorization.md`
**before merge/release**; the workflow's artifact comparison remains mandatory.

## Recovery acceptance

This operational PR needs independent developer approval; its author cannot
merge it. After merge, require exact new-main CI and staging Release success,
successful GitHub deployment, exact running/current SHA, adequate headroom,
healthy DB/backups and intact previous rollback images. Do not equate the
emergency cleanup or HTTP 200 from the older application with recovery.
EGO-142 stays open and the #33 → #32 → #28 → #29 queue remains stopped until
all recovery acceptance checks pass. No production deployment is authorized.
