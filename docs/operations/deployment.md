# Yandex Cloud deployment and rollback

## MVP topology

### Staging: budget single VM

Staging uses one Ubuntu 24.04 x64 VM: 2 vCPU at 20% baseline, 2 GB RAM,
25–30 GB network HDD, and about 4 GB host swap. It runs web, API, worker,
Caddy, the repository-only runner, and local PostgreSQL 17. Object Storage,
Container Registry, and Lockbox remain external services. This is deliberately
not production-grade HA: losing the VM/disk can lose both DB and local backups.
Staging preserves application/container/release semantics, but DB hosting is
intentionally cheaper than production.

`compose.yaml` plus `compose.staging.yaml` adds PostgreSQL only for staging.
The DB has no published port and is on an internal Docker network shared only
with API, worker, and migration. Data lives in the persistent named volume
`digital-autograph-staging-postgres`. Normal Compose up/down and application
rollback retain that volume. Never run `docker compose down -v`, volume prune,
or delete this volume during release or routine cleanup.

PostgreSQL reserves 128 MB and has a 384 MB RAM / 768 MB RAM-plus-swap limit,
with 64 MB shared buffers and 30 connections. These are conservative starting
settings for low-traffic smoke testing, not a capacity guarantee. No application
memory caps are imposed: photo processing needs transient memory. Monitor OOM,
RSS, swap usage, free disk, and worker processing during physical smoke.

### Production: Managed PostgreSQL

Production keeps a separate VM and Managed PostgreSQL cluster on a private
network, managed backups/PITR and a tested restore procedure. Separate private
buckets, Lockbox secrets, runtime service accounts, and domains are required.
No local PostgreSQL service is added to the production Compose path. The
Compose/images can later move to Instance Groups without changing application
architecture. No new production backup architecture is introduced here.

The VM accepts inbound HTTP/HTTPS for Caddy only. A self-hosted GitHub Actions
runner on each VM uses outbound HTTPS to GitHub and Yandex Cloud; deployment
does not open SSH to GitHub-hosted runner address ranges or store a deployment
SSH key. Restrict the runner to this repository, trusted `main`-branch
workflows, and the matching `da-staging` or `da-production` label. The runner's
Docker access is effectively root access; do not run pull-request code on
these runners. GitHub Free private repositories do not provide protected
Environment approvals, so production release authorization is enforced by a
repository Actions variable and an explicit manual confirmation in the release
workflow.

## One-time Yandex Cloud provisioning

Provision resources separately for each environment, except for the shared
immutable-image Container Registry:

- Ubuntu 24.04 VM, public IP, and a network security group permitting inbound
  TCP 80/443. Limit any administrative SSH to the operator's IP. For staging,
  use the budget spec above; do not provision Managed PostgreSQL.
- For production only, provision Managed PostgreSQL database/app user on the
  private network; allow port 6432 only from its application VM security group.
  Enable managed backups/PITR and test a restore.
- Private Object Storage bucket. Never enable public access; originals must
  remain private. Create S3-compatible access keys scoped to the bucket.
- Lockbox secrets and a runtime service account attached to the VM. Grant
  registry pull access, Lockbox payload access only to this environment's
  secrets, and only the bucket read/write/delete permissions needed by the
  API and worker.
- One shared Container Registry for release artifacts and a GitHub staging CI
  service account with `container-registry.images.pusher` on that registry.
  The publisher is used only on the standard GitHub-hosted builder: no Lockbox,
  S3, VM runtime or production grants. Both VM runtime service accounts get
  `container-registry.images.puller` on this registry, never publisher/pusher
  roles. Keep staging Lockbox/S3 grants staging-only and production runtime
  grants separate. Use a dedicated repository with no tag-overwrite workflow
  outside the release workflow.
- A Yandex workload identity federation for GitHub Actions. Use issuer
  `https://token.actions.githubusercontent.com`, JWKS URL
  `https://token.actions.githubusercontent.com/.well-known/jwks`, and
  audience `https://github.com/<OWNER>`. Bind the federation selector to this
  repository's trusted `main` ref (`repo:<OWNER>/<REPO>:ref:refs/heads/main`)
  and the staging CI service account. Production does not need an
  image-publishing identity: production pulls the image already deployed to
  staging.
- A GitHub Actions self-hosted runner per VM, labelled `da-staging` and
  `da-production` respectively. Install Docker Engine, the Compose v2 plugin (2.24.4 or newer for `!reset`),
  Node.js 24 for the Lockbox renderer, `yc`, `gh`, `curl`, and `jq` on the VM.
  Docker Buildx is used on the hosted builder, not required by the VM deploy path. Configure the VM's attached service
  account for `yc`, Lockbox, and the registry credential helper. The runner
  user must be trusted with Docker/root access and non-interactive `sudo`;
  configure the helper/token profile for the same root context.
- Domain A records for `WEB_DOMAIN` and `API_DOMAIN` pointed at that
  environment's VM. Caddy obtains and renews HTTPS certificates; ensure ports
  80/443 and outbound ACME traffic are available.

See the official [GitHub workload identity federation tutorial](https://yandex.cloud/en/docs/iam/tutorials/wlif-github-integration),
[Container Registry authentication](https://yandex.cloud/en/docs/container-registry/operations/authentication),
[Managed PostgreSQL connection guide](https://yandex.cloud/en/docs/managed-postgresql/operations/connect),
[Object Storage access](https://yandex.cloud/en/docs/storage/concepts/bucket), and
[Lockbox payload CLI reference](https://yandex.cloud/en/docs/lockbox/cli-ref/payload/get).

### Lockbox payloads

Create one API secret and one worker secret per environment. Payload entries
are plain-text key/value pairs; do not put them in GitHub Actions variables,
the repository, or deployment logs.

Fetch runtime payloads with `yc lockbox payload get --format json-rest`.
That CLI format uses camelCase fields, including `textValue`, as required by
the renderer; plain `--format json` uses incompatible snake_case fields. Pipe the
payload directly to the renderer without printing its contents.

API payload keys:

- `DATABASE_URL`: staging uses
  `postgresql://<user>:<URL-encoded-password>@postgres:5432/<staging-db>?sslmode=disable`.
  API and worker must use the same user/database/password. The renderer derives
  the staging PostgreSQL env file from the API URI, validates both app URIs use
  the private `postgres` service, and rejects external hosts or TLS overrides.
  Production keeps its Managed PostgreSQL URI with
  `sslmode=verify-full&sslrootcert=/run/secrets/postgres-ca.pem`.
- `SESSION_TTL_SECONDS`, `TRUSTED_WEB_ORIGINS`, and `WEB_ORIGIN`.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
- `TELEGRAM_CLIENT_ID`, `TELEGRAM_CLIENT_SECRET`, `TELEGRAM_REDIRECT_URI`.
- `S3_ENDPOINT=https://storage.yandexcloud.net`, `S3_REGION=ru-central1`,
  `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`.
- `UPLOAD_URL_TTL_SECONDS` and `PREVIEW_URL_TTL_SECONDS`.

Worker payload keys are `DATABASE_URL` (same environment, with TLS settings),
`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `WORKER_POLL_INTERVAL_MS`, `WORKER_LEASE_SECONDS`,
and `UPLOAD_CLEANUP_GRACE_SECONDS`.

For production, install the database TLS root certificate read-only at
`/etc/digital-autograph/certs/yandex-cloud-root.crt` and verify the external DB
connection with TLS. The staging override removes these CA mounts; its DB
traffic stays on the internal Docker network. Confirm URI encoding for reserved
characters in credentials. PostgreSQL initialization credentials apply only to
an empty volume: rotate an existing DB password with an explicit SQL procedure
and update both Lockbox payloads together; changing the env file alone does not
change an existing PostgreSQL role. Use real HTTPS domains and
provider callback URLs in each environment; register each exact OAuth callback
with Google and Telegram.

## GitHub configuration

For the private GitHub Free repository, do not create or depend on protected
GitHub Environments, environment secrets, or required reviewers. Configure
these non-secret values as repository-level Actions variables:

- `YC_SERVICE_ACCOUNT_ID`: staging image-publisher service account.
- `YC_REGISTRY_ID`: shared immutable-image Container Registry.
- `RELEASE_OPERATOR`: the exact GitHub login authorized to start production
  deploys and rollbacks.

Keep all runtime secrets in Yandex Lockbox. Add `APP_ENV` (`staging` or
`production`), `YC_REGISTRY_ID`, `YC_LOCKBOX_API_SECRET_ID`,
`YC_LOCKBOX_WORKER_SECRET_ID`, `WEB_DOMAIN`, and `API_DOMAIN` to
`/etc/digital-autograph/deploy.conf` on each VM (this file contains resource
identifiers and domains, never secret values).

The release workflow only accepts manual dispatches from `main`. A production
operation runs only for `RELEASE_OPERATOR`, requires the operator to enter
`APPROVED`, verifies successful CI and a successful staging deployment for the
same full SHA from trusted main history (successful push CI, not PR CI), then dispatches to the dedicated production runner. The
operator's confirmation is the review gate on GitHub Free; a reviewer must
review the change before the operator confirms. Do not describe this as GitHub
Environment protection or branch protection.

## Release behavior

Deploy operations check out the exact validated `IMAGE_SHA` and verify the Git
HEAD before executing any release scripts. Manual rollback uses the current
main release configuration and the previous image tag recorded on the VM,
independent of a developer checkout.

1. Successful trusted same-repository push CI for `main` starts hosted `prepare`.
   It validates the request and exports the exact CI head SHA. Hosted
   `build_publish` (`ubuntu-latest`) checks out/verifies that SHA, exchanges a
   short-lived GitHub OIDC token for the registry-only publisher IAM token,
   and builds/pushes API/web/worker/migration images under the immutable commit
   tag. Existing SHA images are reused; registry errors fail closed.
   Only a successful publication schedules the self-hosted `deploy` job.
   Manual deploy/rollback bypass publication; their authorization gates run
   on the hosted prepare job before any VM is scheduled.
2. The dedicated VM job checks out/verifies the exact published (or manually
   validated) SHA and creates its deployment record. It has only GitHub contents
   read/deployments write, no publishing OIDC permission or publisher token.
   The VM obtains the API and worker payloads from its environment's Lockbox,
   writes owner-only runtime environment files, pulls the SHA-tagged images,
   and uses one environment-selected Compose helper for pull, startup, migration,
   health checks, and rollback. Deploy pulls all four ready images, including
   migration, before DB startup or migration. Missing images stop the operation;
   manual staging and production never rebuild. Staging first starts/waits for PostgreSQL, then
   takes a custom-format `pg_dump` before running migration (including an empty
   first-deploy DB). It
   then starts/replaces Compose services.
3. Smoke checks require the API readiness endpoint, the public web origin,
   and a running worker. The deploy script records the active and previous
   image tags only after checks pass. The workflow records GitHub deployment
   status so a production dispatch can verify that the exact SHA completed
   staging successfully.
4. The SHA tags are published only when missing; a rerun will reuse existing
   SHA-tagged images rather than rebuilding over them. Do not manually retag a
   release image. After review and successful staging, the configured
   `RELEASE_OPERATOR` dispatches `Release` from `main` with target `production`,
   operation `deploy`, that exact image SHA, and `APPROVED` confirmation.
5. To roll back an application, dispatch the same workflow with the target
   environment and operation `rollback`. The VM redeploys its recorded
   previous image without rerunning migrations. A failed health check during a
   new deploy also attempts to restore the previously healthy application
   image. Compose startup errors cannot count as a successful release; smoke
   checks also verify API/web/worker containers use the requested image tags.
   Registry login remains available through an automatic rollback and is
   removed on script exit. Registry inspection errors fail closed instead of
   treating authentication/network failures as permission to overwrite a tag.

Database schema is not automatically rolled back. Migrations must follow
expand/deploy/contract: add backward-compatible schema, deploy and verify the
application, then remove obsolete schema in a later release. A failed
migration blocks application replacement. If a migration has already
succeeded, restore compatibility with a forward-fix; restore from a tested
database backup/PITR only for data recovery, with a controlled connection
cutover. Roll back secrets separately by reactivating the intended Lockbox
version; never print payloads or IAM tokens.

## Local validation

Build the same image targets and validate the compose model before using the
release workflow:

```sh
docker buildx bake --file deploy/docker-bake.hcl release
```

Before connecting a VM to the runner, validate Compose without printing the
resolved secrets, after provisioning its runtime environment files:

```sh
# Production
sudo docker compose --env-file /opt/digital-autograph/release.env \
  -f /opt/digital-autograph/compose.yaml config --quiet
# Staging
sudo docker compose --env-file /opt/digital-autograph/release.env \
  -f /opt/digital-autograph/compose.yaml \
  -f /opt/digital-autograph/compose.staging.yaml config --quiet
```

Use only the command for the VM's environment. Those files must contain only that environment's values
and must never be copied between staging and production.

## Staging backups and migration failure

Before every staging deploy migration, write a dump under
`/var/lib/digital-autograph/staging-backups` (directory 0700, dumps 0600).
Only the newest three successfully completed dumps are retained. A failed dump
blocks migration. A failed migration exits before replacing application
containers, leaves the recorded current image unchanged, and retains the dump.
Rollback uses the same staging Compose context and persistent volume, skips
migration/backup, and never restores schema automatically. These local dumps
protect a small staging test DB from operator mistakes, not VM/disk loss.

To rehearse recovery, copy a completed dump into an isolated test environment,
inspect it with `pg_restore --list`, and restore only after reviewing the
migration compatibility and selecting an explicit recovery target. Do not
restore over the active staging DB automatically. Production continues its
managed backup/PITR procedure.

## Host swap and GitHub-hosted builds

Configure swap on the VM host, never inside containers. On a newly provisioned
Ubuntu VM with no existing `/swapfile`, an operator can configure 4 GB:

```sh
sudo dd if=/dev/zero of=/swapfile bs=1M count=4096 status=progress
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
# Add this line once to /etc/fstab:
# /swapfile none swap sw 0 0
free -h
```

Do not overwrite an existing swapfile. Set a disk-space alarm: OS, swap,
PostgreSQL volume, three dumps, pulled images and container logs share only
25–30 GB. Manage obsolete images/logs selectively; never prune volumes. Keep
active and previous release images available for rollback. Buildx cache lives
on the hosted builder, not on this VM.

The Dockerfile has one shared build stage: dependency installation, API/worker
TypeScript builds, Next.js production build and two pnpm deploy operations.
Buildx reuses this stage across four targets. Release builds now run exclusively
on the standard GitHub-hosted `ubuntu-latest` x64 runner, currently documented
as 2 CPUs / 8 GB RAM / 14 GB SSD for private repositories. No paid larger runner
is configured. The 2 GB staging VM only pulls ready images, backs up/migrates
its DB, starts containers and checks health; routine deployment does not require
a temporary resize to 4 GB. Keep 4 GB host swap for runtime memory bursts,
not for building release images.

Private-repository GitHub-hosted Actions minutes, artifact/cache storage and
any overage are limited resources. Check the repository owner's GitHub Billing
and set budgets/alerts before enabling releases. CI container validation and
release publication both consume hosted minutes; reruns reuse existing release
tags rather than overwriting them. Cloud balance does not cover GitHub charges.
See the [standard runner specifications](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
and [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

## Fixed staging domains and OAuth

Registrar/DNS: **REG.RU**. The future staging VM non-secret deploy configuration
must contain:

```sh
APP_ENV=staging
WEB_DOMAIN=staging.destka.online
API_DOMAIN=api.staging.destka.online
```

After provisioning a static staging IP, configure these DNS records:

| Name                      | Type | Value          |
| ------------------------- | ---- | -------------- |
| staging.destka.online     | A    | `<STAGING_IP>` |
| api.staging.destka.online | A    | `<STAGING_IP>` |

No DNS changes are performed by this PR. Allow HTTP/HTTPS to Caddy and verify
both names resolve to the staging IP before release. Keep production domains
and runtime resources separate.

Register exact staging provider callbacks manually:

- Google: `https://api.staging.destka.online/auth/google/callback`
- Telegram: `https://api.staging.destka.online/auth/telegram/callback`

Use those same URLs in the respective staging Lockbox keys; set `WEB_ORIGIN`
and `TRUSTED_WEB_ORIGINS` to `https://staging.destka.online`. Provider settings
are not changed by this PR.

## Staging cost target

Planning target: **approximately 1500–1700 RUB/month** at 24/7 use with little
user traffic, no Managed PostgreSQL, no production resources and controlled
image/secret version retention. This is a budget target, not a tariff quote.

| Component          | Budget basis                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| Compute VM         | Main cost; official Ice Lake example for 2 × 20% vCPU + 2 GB RAM is 1224 RUB per 30 days            |
| Public IP          | About 190 RUB per 30 days at the documented active-IP example rate                                  |
| Disk               | Budget separately for 25–30 GB network HDD, including swap/DB/backups/cache                         |
| Lockbox            | Budget for two active secret versions and payload read operations; old versions add cost            |
| Object Storage     | Small private test uploads plus request/traffic charges                                             |
| Container Registry | Unique stored image layers, traffic and optional vulnerability scans; retain only reviewed releases |

Actual cost depends on current tariffs, selected platform/region, month length,
stored data and hosted Actions usage (billed separately by GitHub). Check the live calculator before
provisioning and set billing alerts. With a 3990 RUB balance, 1500–1700 per
month leaves roughly 590–990 RUB after two months, before unexpected usage.
Do not treat that as a guaranteed minimum lifetime.

Stop the staging VM during long idle periods to reduce compute charges. Disk,
Lockbox, registry and bucket storage charges continue. A reserved static IP also
continues billing and becomes more expensive while inactive, so stopping is not
zero cost. No automatic deletion of cloud resources is performed.

Current pricing sources (reviewed 2026-10-01):
[Compute](https://yandex.cloud/ru/docs/compute/pricing),
[VPC/IP](https://yandex.cloud/ru/docs/vpc/pricing),
[Lockbox](https://yandex.cloud/ru/docs/lockbox/pricing),
[Object Storage](https://yandex.cloud/ru/docs/storage/pricing), and
[Container Registry](https://yandex.cloud/ru/docs/container-registry/pricing).
