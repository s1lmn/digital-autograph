# Staging runner disk diagnosis (EGO-142 / EGO-143)

EGO-142 records a failed release at main SHA
`de5b81ee44160a303151989770f1bb022bc502fa`: the runner could not write its
diagnostic log (`No space left on device`). Successful HTTPS readiness alone
does not prove that release finished or that the intended images are running.
That incident required the integration queue to stop until recovery was verified.
Recovery was accepted in EGO-142 on 2026-10-08 after exact-main CI, staging
Release and measured VM acceptance; the initial failure below remains useful
for future diagnosis, not a claim that the queue is currently stopped.

## Collect evidence after operator access is restored

Use an independently reviewed copy of `deploy/staging-disk-inventory.mjs` on
the staging VM with Node 24. It is an operator tool, outside the release workflow.
Run it from an existing administrative session; do not add SSH keys or change
cloud metadata as part of this command. No registry/cloud credentials are needed.

```sh
sudo node /path/to/reviewed/staging-disk-inventory.mjs
# Only if the runner is installed elsewhere:
sudo node /path/to/reviewed/staging-disk-inventory.mjs --runner-root /actual/runner/path
```

The tool writes JSON to stdout. Capture it on the operator computer rather than
redirecting it onto an exhausted VM disk. Exit 0 means all inventory probes
succeeded; exit 1 means incomplete evidence, including missing files, denied
access, timeout or malformed output. Exit 2 means unsupported platform/arguments.
Absent previous-release state also makes the inventory incomplete. A successful
inventory does not certify deployment, backup validity or sufficient free space.

Each command has a 30-second timeout and 1 MiB output cap. GNU `df` and `du`
provide byte/inode availability and allocated directory size; directory scans
stay on their filesystem and may consume disk I/O. Docker inspection uses a
field projection and reports IDs, status, recognized service names and named
volumes. Bind mounts do not have a Docker `Name` field; their paths are never
requested, and only named-volume names enter the report. No container logs, environment variables, command arguments, bind-mount
paths, secret configuration or backup/object contents are returned. Command
errors are deliberately suppressed; unavailable probes need operator follow-up.
Backup entries report filename/size/time only: a `.dump` suffix proves neither
a completed `pg_dump` nor a successful restore. Unrecognized backup filenames
are omitted; their allocated space is still included in the aggregate directory.

## Diagnose before deciding what may be removed

Compare root bytes and inode availability, root directory totals, Docker root
and its images/container/volume/build-cache totals, runner `_work` / `_diag`,
system logs/cache and staging backup totals. Mounts may use separate filesystems;
use the corresponding capacity probe. Root totals cannot establish the culprit
when a scan is incomplete. Docker reclaimable size is an estimate, not approval
to delete its contents.

Preserve every running container image ID, all API/web/worker/migration images
for both recorded current and previous SHAs, and every mounted persistent
volume, especially `digital-autograph-staging-postgres`. A missing rollback
image needs investigation, not permission to delete the remaining image.
Preserve private object storage and valid database backups. Verify backup
integrity/restore and actual database/migration state separately through the
existing deployment/restore procedure; this tool does not query PostgreSQL.

Use collected evidence to propose a narrowly scoped, separately reviewed
cleanup/retention change with explicit targets, retained rollback/backup set and
capacity requirements. The accepted staging-specific preflight and retention bounds are documented in
[staging capacity](staging-capacity.md); they are not universal host thresholds. Do not run blanket Docker/image/volume prune or remove database files,
objects or backup dumps. This PR adds no cleanup, preflight, service restart or
release rerun.

## Recovery acceptance remains separate

After approved capacity remediation, rerun the failed staging release through
the normal workflow. Verify the exact trusted main SHA, actual running API/web/
worker image references, database/migration/backup state, readiness and successful
GitHub deployment status. Document measured capacity, the identified consumer,
the retained rollback/backup evidence and the chosen prevention guard in EGO-142.
For a new incident, keep its recovery task and the integration queue open/stopped
until that evidence exists. EGO-143 delivers the diagnosis tool; its green CI
does not by itself certify recovery. A root directory scan on the staging HDD
can exceed the bounded 30-second probe budget: it stays `unavailable`, with exit
1, rather than presenting partial totals as complete evidence. Other successful
probes remain usable; a full root scan requires separate operator investigation.
