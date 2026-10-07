# Digital Autograph Platform

Modular monolith with a Next.js web shell, Fastify API, Node.js worker, PostgreSQL, and local MinIO. The backend provides Creator/Wall and private Autograph upload APIs; claims, processing, and payment flows are still to come.

## Prerequisites

- Node.js 24 LTS and pnpm 11.19.0
- Docker with Compose for local PostgreSQL and MinIO
- Git

## Local setup

```sh
git clone <repository-url>
cd <repository-directory>
cp .env.example .env
pnpm install
pnpm infra:up
pnpm db:migrate
pnpm dev
```

`pnpm dev` runs web (`http://127.0.0.1:3000`), API (`http://127.0.0.1:4000`), and worker. Check `GET http://127.0.0.1:4000/health/live` for process liveness and `GET http://127.0.0.1:4000/health/ready` for PostgreSQL readiness. MinIO's local console is at `http://127.0.0.1:9001`; API startup creates the private local autograph bucket automatically.

The local MinIO image is a pinned community build of the upstream MinIO release because the upstream container registry did not allow pulling the release during bootstrap verification. It is used only for local development.

The sample `.env` values are local-only. Provide real secrets through the deployment environment when that environment is designed. All server configuration is validated at startup; the web health check runs server-side so `API_INTERNAL_URL` is not bundled for the browser. `API_PUBLIC_ORIGIN` is the browser-visible API origin used by the canvas page. Supported `APP_ENV` values are `local`, `test`, `development`, `staging`, and `production`. Local MinIO uses the sample `S3_*` settings; production must supply a private bucket and storage credentials or an SDK role provider. See [autograph-domain.md](docs/architecture/autograph-domain.md).

Auth Core requires `SESSION_TTL_SECONDS` and `TRUSTED_WEB_ORIGINS` in the API environment. The latter is a comma-separated list of exact web origins allowed to send credentialed requests. See [authentication.md](docs/architecture/authentication.md) for session and cookie behavior.

Google sign-in additionally requires server-only `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `WEB_ORIGIN`. Create a Google OAuth **Web application** client and register `http://127.0.0.1:4000/auth/google/callback` as an exact authorized redirect URI for the sample local configuration. Replace the `.env` placeholders with that client's credentials; do not commit them. Keep the API start URL and callback on the same host so the short-lived browser-binding cookie reaches the callback. Open `http://127.0.0.1:4000/auth/google/start` to begin login, optionally with a local `returnTo` path. Staging and production require HTTPS callback and web origins. The web shell currently provides only a small failure page; the main product sign-in UI will follow later.

Telegram sign-in requires server-only `TELEGRAM_CLIENT_ID`, `TELEGRAM_CLIENT_SECRET`, and `TELEGRAM_REDIRECT_URI`. In @BotFather, create or select the application bot, open **Login Widget / Login**, add the website origin and the exact OIDC redirect URI to **Allowed URLs**, and obtain the Client ID and Client Secret shown there. For the sample local configuration, register `http://127.0.0.1:4000/auth/telegram/callback` exactly. The Client Secret is an OIDC credential, distinct from the bot's Bot API token. Replace the placeholders in your ignored `.env` or deployment secrets; do not commit credentials. Open `http://127.0.0.1:4000/auth/telegram/start` to begin login, optionally with a local `returnTo` path. Keep the start URL and callback on the same API host for the temporary cookies. Staging and production callbacks require HTTPS. The web shell currently has no login button.

## Checks

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm infra:test:up
pnpm test:integration
pnpm build
pnpm test:build-smoke
```

`pnpm test` runs all unit tests on Linux. On Windows it runs the portable unit
suite; `*.posix.test.ts` fixtures need Bash, executable shims or Unix file modes
and are verified by Linux CI. Only tests with that explicit suffix are excluded
on Windows, so portable deployment configuration, CORS validation and Lockbox
escaping/redaction tests still run there.

Use `pnpm test:portable` for the same portable suite on either platform and
`pnpm test:posix` for the deployment/permission suite on Linux. The latter fails
with an explicit platform error on Windows. A green Windows run covers portable
unit tests; the Linux `checks` job continues to run the full unit suite plus
integration/build/container checks, and the `windows-unit` job runs the default
Windows command. Both Windows jobs, Linux `checks` and `e2e` must pass before merge. Unit tests require no
local PostgreSQL, MinIO or cloud credentials.

The integration suite requires the separate `autograph_test` PostgreSQL instance on port 5433 and local MinIO on port 9000. It rejects a database URL with another database name, applies committed migrations, and then runs against that schema and a private test bucket. CI provisions PostgreSQL and MinIO. `pnpm db:generate` generates Drizzle migrations after schema changes; custom SQL migrations capture database triggers.

Run the suite with `pnpm test:integration` on Windows and Linux. The runner uses
the package-manager launcher supplied by pnpm (`npm_execpath`), invoking JavaScript
launchers with the current Node executable and standalone executables directly.
This avoids spawning the Windows `pnpm.cmd` shim or enabling a shell. Direct
`node scripts/run-integration.mjs` invocation without pnpm's environment is not
supported. Migration failures stop the runner before Vitest, and either child's
failure makes the command fail.

`pnpm infra:down` stops both regular and test-profile containers while preserving the named development volumes. The test database uses temporary container storage and is recreated on the next `pnpm infra:test:up`.

## Workspace

- `apps/web`: presentation and a server-side API health call.
- `apps/api`: HTTP endpoints and application orchestration.
- `apps/worker`: process lifecycle and future background tasks.
- `packages/domain`: framework-independent rules.
- `packages/auth`: provider-independent session lifecycle.
- `packages/walls`: Creator/Wall application rules.
- `packages/autographs`: owner-scoped Autograph and private-upload application rules.
- `packages/db`: PostgreSQL connection, domain schema, Drizzle migrations, transaction access.
- `packages/contracts`: shared Zod API schemas.
- `packages/integrations`: Google and Telegram OIDC plus private S3-compatible storage adapters.
- `packages/ui`: future shared UI primitives.
- `packages/config`: typed server environment loading.

See `AGENTS.md` for permanent invariants, `docs/architecture/domain-model.md` for the persistence model, and `docs/adr/` for architectural decisions.

Staging/production provisioning and release procedures are documented in
[the Yandex Cloud deployment runbook](docs/operations/deployment.md).
