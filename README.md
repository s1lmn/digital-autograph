# Digital Autograph Platform

Modular monolith with a Next.js web shell, Fastify API, Node.js worker, PostgreSQL, and local MinIO. Foundational domain tables exist; product APIs and payment flows are still to come.

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

`pnpm dev` runs web (`http://127.0.0.1:3000`), API (`http://127.0.0.1:4000`), and worker. Check `GET http://127.0.0.1:4000/health/live` for process liveness and `GET http://127.0.0.1:4000/health/ready` for PostgreSQL readiness. MinIO's local console is at `http://127.0.0.1:9001`; no bucket or storage adapter is created yet.

The local MinIO image is a pinned community build of the upstream MinIO release because the upstream container registry did not allow pulling the release during bootstrap verification. It is used only for local development.

The sample `.env` values are local-only. Provide real secrets through the deployment environment when that environment is designed. All server configuration is validated at startup; the web health check runs server-side so `API_INTERNAL_URL` is not bundled for the browser. Supported `APP_ENV` values are `local`, `test`, `development`, `staging`, and `production`.

Auth Core requires `SESSION_TTL_SECONDS` and `TRUSTED_WEB_ORIGINS` in the API environment. The latter is a comma-separated list of exact web origins allowed to send credentialed requests. See [authentication.md](docs/architecture/authentication.md) for session and cookie behavior.

Google sign-in additionally requires server-only `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `WEB_ORIGIN`. Create a Google OAuth **Web application** client and register `http://127.0.0.1:4000/auth/google/callback` as an exact authorized redirect URI for the sample local configuration. Replace the `.env` placeholders with that client's credentials; do not commit them. Keep the API start URL and callback on the same host so the short-lived browser-binding cookie reaches the callback. Open `http://127.0.0.1:4000/auth/google/start` to begin login, optionally with a local `returnTo` path. Staging and production require HTTPS callback and web origins. The web shell currently provides only a small failure page; the main product sign-in UI will follow later.

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

The integration suite requires the separate `autograph_test` PostgreSQL instance on port 5433. It rejects a database URL with another database name, applies committed migrations, and then runs against that schema. CI provisions this test database as an isolated service. `pnpm db:generate` generates Drizzle migrations after schema changes; custom SQL migrations capture database triggers.

`pnpm infra:down` stops both regular and test-profile containers while preserving the named development volumes. The test database uses temporary container storage and is recreated on the next `pnpm infra:test:up`.

## Workspace

- `apps/web`: presentation and a server-side API health call.
- `apps/api`: HTTP endpoints and future application orchestration.
- `apps/worker`: process lifecycle and future background tasks.
- `packages/domain`: framework-independent rules.
- `packages/auth`: provider-independent session lifecycle.
- `packages/db`: PostgreSQL connection, domain schema, Drizzle migrations, transaction access.
- `packages/contracts`: shared Zod API schemas.
- `packages/integrations`: Google OIDC adapter and future provider adapters.
- `packages/ui`: future shared UI primitives.
- `packages/config`: typed server environment loading.

See `AGENTS.md` for permanent invariants, `docs/architecture/domain-model.md` for the persistence model, and `docs/adr/` for architectural decisions.
