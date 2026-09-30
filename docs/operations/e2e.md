# Browser E2E tests

The Playwright critical-path test uses a dedicated local PostgreSQL database and
MinIO instance. It resets only a database named `autograph_e2e` on `localhost`
or `127.0.0.1`; never point `DATABASE_URL` at another database.

Start the isolated services and seed the Canvas-ready Wall fixture:

```sh
pnpm infra:e2e:up
$env:DATABASE_URL="postgres://autograph_e2e:e2e_local_only@127.0.0.1:5434/autograph_e2e"
$env:APP_ENV="test"
$env:S3_ENDPOINT="http://127.0.0.1:9002"
$env:S3_REGION="us-east-1"
$env:S3_BUCKET="autographse2e"
$env:S3_ACCESS_KEY_ID="local_minio"
$env:S3_SECRET_ACCESS_KEY="local_minio_password"
pnpm e2e:setup
```

On macOS/Linux, export the same environment variables with the shell's usual
`export KEY=value` syntax. `pnpm e2e:setup` runs migrations and seeds the fixed
ready Autograph, public Wall, and approved cleaned PNG. It refuses to reset any
database other than the isolated local E2E database.

Run Playwright with the API and web app servers started automatically:

```sh
$env:ENABLE_TEST_AUTH_SEAM="true"
$env:E2E_AUTH_USER_ID="f1111111-1111-4111-8111-111111111111"
$env:API_HOST="127.0.0.1"
$env:API_PORT="4000"
$env:SESSION_TTL_SECONDS="1209600"
$env:TRUSTED_WEB_ORIGINS="http://127.0.0.1:3000,http://127.0.0.1:4000"
$env:WEB_ORIGIN="http://127.0.0.1:3000"
$env:GOOGLE_CLIENT_ID="test-google-client-id"
$env:GOOGLE_CLIENT_SECRET="test-google-client-secret"
$env:GOOGLE_REDIRECT_URI="http://127.0.0.1:4000/auth/google/callback"
$env:TELEGRAM_CLIENT_ID="test-telegram-client-id"
$env:TELEGRAM_CLIENT_SECRET="test-telegram-client-secret"
$env:TELEGRAM_REDIRECT_URI="http://127.0.0.1:4000/auth/telegram/callback"
$env:API_INTERNAL_URL="http://127.0.0.1:4000"
$env:API_PUBLIC_ORIGIN="http://127.0.0.1:4000"
pnpm exec playwright install chromium
pnpm test:e2e
```

Test auth routes are registered only when the API has `APP_ENV=test` and
`ENABLE_TEST_AUTH_SEAM=true`; attempting to enable them in production or staging
is rejected. The seam creates a regular database-backed session and uses the
same return-path validation as provider callbacks. It is not a production
login route.

The test writes traces, screenshots, and video only on failure under
`test-results/`; CI publishes those files together with the HTML report.
