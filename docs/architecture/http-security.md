# Baseline HTTP response security (EGO-138)

Fastify applies response headers in a root `onSend` hook, including errors,
not-found responses and CORS preflight replies. Next.js uses a `/:path*` header
rule for pages and assets, including its not-found page. The web does not emit
the framework's `X-Powered-By` header.

Both runtimes send:

- `X-Content-Type-Options: nosniff` to disable content-type guessing.
- `X-Frame-Options: DENY` and
  `Content-Security-Policy: frame-ancestors 'none'; object-src 'none'; base-uri 'self'`
  to reject all framing, plugins and foreign base URLs.
- API `Referrer-Policy: no-referrer` by default; route-specific policies are
  preserved. Web uses `strict-origin-when-cross-origin`.

The hook leaves bodies, status codes, cookies, CORS and cache policy unchanged.
Google and Telegram OIDC remain top-level navigation flows with their existing
`no-referrer` / `no-store` responses. Public cleaned PNGs retain their bounded
public cache; original uploads and private signed URLs remain private.
Do not add blanket `Cache-Control: no-store` or cross-origin isolation headers:
those require a separate analysis of public media and provider flows.

This is a **partial CSP**, not a script execution policy or a complete XSS
defence. It sets no `default-src`, `script-src`, `connect-src`, `img-src` or
`form-action` restrictions. Next.js hydration, canvas/photo previews, private
storage uploads and OAuth redirects keep their existing resource policies.
Camera access is not disabled. A nonce/hash-based script policy, HTTPS/HSTS
rollout (including domain/subdomain readiness), rate limits and the final
pre-launch review remain in EGO-109. EGO-138 does not complete that parent.

Headers are owned by the applications and pass through Caddy's existing
reverse proxy. Any future edge header policy must preserve this policy and
the stricter OAuth response headers. Live staging/Caddy, physical mobile and
Telegram embedded-browser acceptance remain separate from Chromium fixtures.

Regression coverage includes injected API success/HEAD/error/origin/auth/CORS
responses, existing PostgreSQL OIDC and private MinIO public-media tests, real
web HTTP responses and Chromium refusals for both same-origin and foreign
iframe parents. Existing browser flows cover canvas/photo, free claim,
creator lifecycle and payment return.

Implementation references: [Next.js response headers](https://nextjs.org/docs/app/api-reference/config/next-config-js/headers)
and [Fastify request/reply hooks](https://fastify.dev/docs/latest/Reference/Hooks/).

## OAuth resource budgets

Each API process limits each registered Google/Telegram/Yandex/VK start and
callback route to 600 requests per monotonic 60-second window. Eight fixed
buckets retain no IP, account or client-controlled keys. GET query variants and
Fastify's implicit HEAD routes share a bucket. Rejected requests receive no-store
429 AUTH_RATE_LIMITED and Retry-After before session lookup or provider work.
Providers and start/callback budgets are independent; a busy login-start route
cannot exhaust a callback's quota. The Google transport has a 10-second per-HTTP
request timeout; Telegram's OIDC client already defaults to 30 seconds, while
Yandex/VK requests use 10-second abort signals.

This bounds application admission per process, not across replicas. It does not
replace ingress connection/concurrency controls, a distributed abuse policy,
provider registration or a measured drop-capacity acceptance. Those remain
pre-launch requirements under EGO-90/EGO-108/EGO-109.
