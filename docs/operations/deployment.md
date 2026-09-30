# Yandex Cloud deployment and rollback

## MVP topology

Staging and production each run on a separate Ubuntu VM with Docker Compose.
Each VM runs the Next.js web app, Fastify API, image-processing worker, and
Caddy HTTPS reverse proxy. PostgreSQL and Object Storage are managed Yandex
Cloud services, with separate staging and production clusters/databases,
private buckets, Lockbox secrets, and environment-specific service accounts.
No Instance Groups or Kubernetes are required for the MVP. The images,
Compose file, and release script are portable so the services can later move
to Instance Groups without changing application architecture.

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

- Ubuntu 24.04 VM, public IP, and a network security group that permits inbound
  TCP 80/443 only. Keep PostgreSQL private and allow port 6432 only from the
  application VM's network/security group.
- Managed PostgreSQL database and app user. Enable backups and test a restore.
- Private Object Storage bucket. Never enable public access; originals must
  remain private. Create S3-compatible access keys scoped to the bucket.
- Lockbox secrets and a runtime service account attached to the VM. Grant
  registry pull access, Lockbox payload access only to this environment's
  secrets, and only the bucket read/write/delete permissions needed by the
  API and worker.
- One shared Container Registry for release artifacts and a GitHub staging CI
  service account with `container-registry.images.pusher` on that registry.
  Both VM runtime service accounts get `container-registry.images.puller` on
  this registry. Use a dedicated repository with no tag-overwrite workflow
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
  `da-production` respectively. Install Docker Engine, the Compose v2 plugin,
  Docker Buildx, `yc`, `gh`, `curl`, and `jq`. Configure the VM's attached service
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

API payload keys:

- `DATABASE_URL`: this environment's Managed PostgreSQL URI with
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

The database TLS root certificate must be installed read-only at
`/etc/digital-autograph/certs/yandex-cloud-root.crt`. Confirm the connection
URI encoding for reserved characters in credentials, and verify TLS by
connecting from the VM before the first deploy. Use real HTTPS domains and
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
same full SHA, then dispatches to the dedicated production runner. The
operator's confirmation is the review gate on GitHub Free; a reviewer must
review the change before the operator confirms. Do not describe this as GitHub
Environment protection or branch protection.

## Release behavior

1. A successful CI run on `main` starts the staging release on the staging VM.
   The runner exchanges its short-lived GitHub OIDC token for a Yandex IAM
   token, builds separate API/web/worker/migration images, and pushes them
   under the 40-character Git commit SHA tag.
2. The VM obtains the API and worker payloads from its environment's Lockbox,
   writes owner-only runtime environment files, pulls the SHA-tagged images,
   and runs the migration container once against its private database. It
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
   image.

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

Before connecting a VM to the runner, validate Compose with
`docker compose --env-file /opt/digital-autograph/release.env -f
/opt/digital-autograph/compose.yaml config` after provisioning its runtime
environment files. Those files must contain only that environment's values
and must never be copied between staging and production.
