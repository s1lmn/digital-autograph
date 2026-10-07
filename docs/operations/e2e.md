# Automated test foundation and browser E2E

## EGO-96 audit of main

Audited main: `152d221b43171bbf8e8bf6bba092d182f1251bd0`. EGO-133 / PR #18
was merged as `25a50637f4940e00d357ea6692f3c0b5174d8ec4`; its browser test
covered login and a claim using an already-approved autograph, not creation.

| Requirement                           | Main status | Evidence                                                                                                                                                                            | Missing scope addressed here                                                                                                                                |
| ------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Test pyramid                       | PASS        | `packages/domain/src/*.test.ts`, `tests/integration`, `e2e/free-claim.spec.ts`                                                                                                      | None                                                                                                                                                        |
| 2. Wall lifecycle / claim eligibility | PASS        | `walls.test.ts`, `free-claim.test.ts`: owner permissions, lifecycle, one-use evidence, races and rollback                                                                           | None                                                                                                                                                        |
| 3. Auth / permissions                 | PASS        | `auth.test.ts`, `google-auth.test.ts`, `telegram-auth.test.ts`, `autograph-moderation.test.ts`: collisions, disabled users, concurrent callbacks, origin and role checks            | None                                                                                                                                                        |
| 4. Upload / processing                | PASS        | `autographs.test.ts`, `autograph-processing.test.ts`: real private MinIO, malformed input, retry exhaustion, stale leases, cleanup races                                            | None at integration level                                                                                                                                   |
| 5. History invariants                 | PASS        | `placement-history.test.ts`: own history only, privacy, ordering, archived records without public links; `placement-history.test.tsx`                                               | None at integration level                                                                                                                                   |
| 6. Deterministic factories            | PASS        | `tests/integration/fixtures.ts`: user, creator, wall, slot, placement and identity factories                                                                                        | Reuse in browser fixtures                                                                                                                                   |
| 7. New user E2E                       | PARTIAL     | PR #18 login / seeded autograph / claim / reload                                                                                                                                    | Real draw/upload, worker, approval, controlled moderation, personal/public history, logout privacy                                                          |
| 8. Creator E2E                        | PARTIAL     | `walls.test.ts` covers transitions, but unschedules before publishing                                                                                                               | Direct draft → scheduled → live → ended over real HTTP; public UI visibility                                                                                |
| 9. Isolated CI infrastructure         | PARTIAL     | `CI / checks`, `CI / e2e`, dedicated PostgreSQL databases / private MinIO                                                                                                           | Worker orchestration, per-test cleanup, repeatable migration reset and safety boundary                                                                      |
| 10. Serious-bug regression coverage   | PASS        | Image-processing dim paper/blue pen/gradient/shadow/thin-stroke regressions; auth races; claim locking; Lockbox, registry attestation, migration-image and staging CORS regressions | E2E reset / isolation and critical CI gate regressions                                                                                                      |
| 11. Production-critical test gate     | PARTIAL     | Release only accepts successful trusted exact-SHA main push CI                                                                                                                      | Document exact mandatory suite and regression-test the CI/Release contract; server-enforced merge protection remains unavailable on the current GitHub plan |

No application, OAuth, payment, schema or image-processing behavior is changed.
Creator mutation UI belongs to EGO-95. Its existing API is exercised here;
this does not certify a creator dashboard that has not been implemented yet.

## Isolated local run

Use Node 24 and the repository's pinned pnpm version. The following values are
synthetic local credentials, never real OAuth or cloud credentials:

```sh
export APP_ENV=test
export DATABASE_URL=postgres://autograph_e2e:e2e_local_only@127.0.0.1:5434/autograph_e2e
export S3_ENDPOINT=http://127.0.0.1:9002 S3_REGION=us-east-1 S3_BUCKET=autographse2e
export S3_ACCESS_KEY_ID=local_minio S3_SECRET_ACCESS_KEY=local_minio_password
export ENABLE_TEST_AUTH_SEAM=true E2E_AUTH_USER_ID=f1111111-1111-4111-8111-111111111111
export API_HOST=127.0.0.1 API_PORT=4000 SESSION_TTL_SECONDS=1209600
export TRUSTED_WEB_ORIGINS=http://127.0.0.1:3000,http://127.0.0.1:4000
export WEB_ORIGIN=http://127.0.0.1:3000 E2E_WEB_URL=http://127.0.0.1:3000
export API_INTERNAL_URL=http://127.0.0.1:4000 API_PUBLIC_ORIGIN=http://127.0.0.1:4000
export GOOGLE_CLIENT_ID=test-google-client-id GOOGLE_CLIENT_SECRET=test-google-client-secret
export GOOGLE_REDIRECT_URI=http://127.0.0.1:4000/auth/google/callback
export TELEGRAM_CLIENT_ID=test-telegram-client-id TELEGRAM_CLIENT_SECRET=test-telegram-client-secret
export TELEGRAM_REDIRECT_URI=http://127.0.0.1:4000/auth/telegram/callback
export UPLOAD_URL_TTL_SECONDS=300 PREVIEW_URL_TTL_SECONDS=120
pnpm infra:e2e:up
pnpm e2e:setup
pnpm exec playwright install chromium
pnpm test:e2e
# Repeat setup and the full suite to check repeatability, without retry masking.
pnpm e2e:setup
pnpm test:e2e
pnpm infra:e2e:down
```

Use the same Compose project for start/stop, and always remove the dedicated
containers when finished, including after a failed test. The E2E PostgreSQL and
MinIO services use ephemeral tmpfs data, separate from development/integration.
CI provides the same isolated database on port 5434 and fresh MinIO on port 9000.

`e2e/environment.ts` checks APP_ENV, NODE_ENV, database name/host/port,
storage name/host/port and browser origins before destructive setup or requests.
It refuses staging, production and non-loopback targets. Do not run concurrent
E2E commands against the same dedicated DB: the suite deliberately uses one
worker and fresh per-test deterministic fixtures, independent of spec order.

Setup resets both the public schema and Drizzle journal, then runs migrations.
Each test creates a new user with no autograph/history/session, an owner with a
moderator role, a creator, Wall and Slot using the existing integration factories.
Actor contexts use ordinary DB-backed sessions; no new API seam is introduced.
Fixtures close actor contexts, delete their private original/cleaned objects,
truncate test users with cascading relationships, and close DB/S3 clients.

Playwright owns API, web and worker subprocesses and stops them after the run.
Worker readiness is matched against its startup message, not an arbitrary sleep.
Assertions wait for actual HTTP/UI outcomes. Creator scheduling uses fixed dates
and advances only the isolated fixture's due boundary with SQL; no timer-based
launch assumption or production clock override is needed.

Test auth is registered only with APP_ENV=test and ENABLE_TEST_AUTH_SEAM=true;
staging and production reject it. It uses normal sessions and return-path checks.
Provider collision/security validation stays in mocked-provider integration
suites; these E2Es never log in to real Google/Telegram accounts.

The user flow checks real signed PUT headers, private originals/cleaned assets,
worker preview, approval/moderation, one active placement and one durable claim,
history updates without reload, manual refresh and reload, own-only history,
and anonymous history after logout. The creator flow uses existing owner API
mutations and checks scheduled/live/ended public pages, denial for a different
user, early launch rejection, persisted slots/state and terminal-state rejection.

Failures retain traces, screenshots and video under `test-results/`; CI uploads
them with `playwright-report/`. Inspect artifacts before publishing externally:
traces can include short-lived private presigned URLs. There are zero retries.

## Mandatory pre-production test gate

The authoritative commands are the actual `.github/workflows/ci.yml` jobs:

| CI job                       | Required validation                                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checks`                     | `pnpm security:audit`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, full portable + POSIX `pnpm test`, `pnpm test:integration`, `pnpm build`, `pnpm test:build-smoke` |
| `checks`                     | All four release container targets via `docker buildx bake --file deploy/docker-bake.hcl release`; `pnpm test:migration-image` (clean PostgreSQL, twice, no TTY)             |
| `e2e`                        | Isolated setup, critical Playwright user and creator flows via `pnpm test:e2e`                                                                                               |
| `windows-integration-runner` | Launcher, isolated-database guard and child-failure regression tests on Windows via `pnpm test apps/api/scripts/integration-runner.test.ts`                                  |
| `windows-unit`               | All portable unit tests through the default Windows `pnpm test`; POSIX deployment fixtures remain mandatory in Linux `checks`                                                |
| PR Policy / `policy`         | Issue reference, scoped review sections, main base, branch naming and secret-pattern checks before merge                                                                     |

All four CI jobs must finish successfully at the reviewed SHA. The Windows jobs
check portable units and runner portability without DB/storage; `checks` runs the full PostgreSQL
and MinIO integration suite on Linux. No critical suite may
be skipped, made continue-on-error, retried to hide flakiness, or replaced by a
successful PR run for a different SHA. Actionlint is an additional local check
when workflows change; it is not currently a mandatory CI step.

Automatic Release requires successful same-repository main **push** CI.
Manual deploy requires a full SHA in trusted main history and successful main
push CI for that exact SHA. Production additionally requires the authorized
RELEASE_OPERATOR, explicit APPROVED and a successful staging deployment of the
same SHA. Existing deployment tests execute rejected/accepted requests; the
critical test-gate regression also protects mandatory CI commands. A failing
E2E/integration/migration check therefore blocks normal trusted deployment.

**Merge enforcement limitation:** this private GitHub Free repository currently
returns HTTP 403 for branch protection/rulesets. CI and PR Policy report failures,
but GitHub does not server-enforce required checks before a maintainer merge.
The operational merge gate is fresh exact-head checks + review + explicit merge
authorization. To meet a strictly automatic merge-blocking DoD, enable protected
main / required checks on a supporting GitHub plan, including `checks`, `e2e`, `windows-integration-runner`, `windows-unit`,
`policy`, and review requirements. Do not claim that protection already exists;
this PR does not alter repository billing, visibility, IAM or authorization.
