# Yandex ID authentication — Stage B1

Related: [EGO-90](https://linear.app/egor-loshkarev/issue/EGO-90),
[EGO-74](https://linear.app/egor-loshkarev/issue/EGO-74),
[EGO-109](https://linear.app/egor-loshkarev/issue/EGO-109).

This draft implements anonymous login only, on a fresh `main` base. It does not
implement account linking, reauthentication, unlink, recovery, VK ID or Twitch.
It preserves the existing Google/Telegram settings and handlers. It is not legal
approval, creator verification, a release or production activation.

## Provider contract

The official [authorization-code documentation](https://yandex.ru/dev/id/doc/ru/codes/code-url)
describes state, PKCE S256, code exchange and redirect registration. The
[user-information API](https://yandex.ru/dev/id/doc/ru/user-information)
provides `id` and `client_id`. This implementation requests JSON; it does not
assume an OIDC ID token or send/verify an OIDC nonce.

The fixed endpoints are `https://oauth.yandex.ru/authorize`,
`https://oauth.yandex.ru/token`, and `https://login.yandex.ru/info?format=json`.
Only `login:info` is requested. This permission can return names/gender as well
as identity; the adapter discards all profile fields and returns only `id`.
No email, avatar, phone or birthday permission is requested. Registered app
permissions must be inspected before approval; the real minimum scope and actual
provider behavior still require an operator test app check.

The returned `client_id` must equal our configured application. The identity is
`('yandex', id)`, with a bounded nonempty opaque ASCII ID. `psuid`, email, login,
name, avatar and phone do not substitute for that ID. Invalid/oversized JSON,
unsafe token shape, foreign client ID and provider redirects/errors fail closed.
The adapter has fixed endpoints, finite response sizes, per-request timeouts and
no retries of a consumed authorization code. Provider error bodies/causes never
leave the adapter.

## Attempts, callback and sessions

Start creates a 600-second attempt using the existing PostgreSQL repository.
State and browser binding are independent cryptographic random values; the PKCE
verifier is hashed in the database. Two provider-specific HttpOnly cookies hold
browser binding and verifier temporarily: Secure in staging/production,
SameSite=Lax, Path=/, no Domain; production uses `__Host-` names. Callback clears
both cookies on success/failure. Abandoned cookies expire after 600 seconds.

The existing attempt schema requires a nonce hash, so `createPkce` also creates
an inert random hash. No raw nonce is sent to Yandex or stored in its cookie.
`claimOAuthPkce` verifies state, browser binding and verifier, and atomically
consumes the attempt before token exchange. Telegram's nonce-required
`claimPkce` behavior is retained. No schema migration is needed.

Start/callback Host must equal the registered callback host. Callback paths are
fixed; duplicate state/code/error parameters and code/error ambiguity are
rejected. Configuration accepts only the canonical callback URL without query,
fragment or userinfo. Yandex's documentation notes that a redirect URI not
exactly registered may be ignored: an operator must verify the actual app
registration, not assume our local URL validation proves registration.

The code is exchanged on the backend with client authentication and the PKCE
verifier. The short-lived access token is used once for authenticated user info;
access/refresh tokens, code and verifier are not application records or logs.
They exist only in transient request/function memory, or the short-lived
HttpOnly verifier cookie. JavaScript receives no provider token.

Identity resolution reuses `IdentityService`, transactional provider identity
uniqueness and active-user checks. Sessions are the existing PostgreSQL opaque
sessions, not a new token mechanism. Session creation rechecks active status.
Same provider ID returns the same UUID; first login inserts one user and identity.
Concurrent first logins serialize; the unique index remains the final guard.
An existing authenticated session is never replaced or linked by this flow.
Both start and callback reject it. A new Yandex login matching a Google user's
email creates a separate account, not an automatic merge.

Return navigation uses the stored, normalized local path on WEB_ORIGIN, preserving
Wall context. Existing exact-origin CORS/CSRF, cookies and logout behavior are
unchanged. Login does not grant creator rights, user roles or financial access
to other users' records.

## Disabled-by-default configuration

All settings are server-side. No `NEXT_PUBLIC_` activation switch exists.

| Parameter              | Meaning                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| `YANDEX_AUTH_ENABLED`  | Default `false`; operator opt-in                                                               |
| `YANDEX_AUTH_APPROVED` | Default `false`; separate operator attestation that legal and operational gates were completed |
| `YANDEX_CLIENT_ID`     | External OAuth application identifier                                                          |
| `YANDEX_CLIENT_SECRET` | External secret-manager value, never public or committed                                       |
| `YANDEX_REDIRECT_URI`  | Exact registered `/auth/yandex/callback` URI                                                   |

Both gates must be exactly `true`; otherwise configuration is inactive and
`/auth/yandex/start` and `/auth/yandex/callback` are not registered. Credentials
alone do not activate anything. If both gates are enabled but mandatory settings
are missing/invalid, startup fails with values redacted. No silent fallback to
another redirect or provider occurs. Gates take effect on process configuration
reload/restart; no runtime flag editor is added. When the process is disabled,
previously issued callbacks also have no route.

Callback origin must match the existing configured Google callback origin (the
same API service, without modifying Google configuration). HTTP is restricted
to loopback in local/test/development. Staging/production require HTTPS and
callback host equal to WEB_ORIGIN host or `api.<web host>`, fitting the current
staging topology. New deployment topologies need separate review rather than
loosening this validation silently.

`GET /auth/providers` returns only `{ yandex: boolean }` with no-store. The
prepared “Продолжить через Яндекс ID” link is hidden until the server reports
availability; fetch/configuration errors keep it hidden. It is integrated into
account, create-autograph, Wall claim, personal history and moderation sign-in
states. Browser manipulation of visibility cannot register a disabled API route.

## Relation to Stage A and the legal PR chain

Stage B1 is a deliberate narrower slice than the proposed B0 sensitive linking
foundation. This draft implements only anonymous login; no reauth/grant, linking,
unlink or last-method handling is partially exposed. Those remain separate.

PR #46 → #52 → #53 → #54 and PR #47/#49 are unchanged. First-use legal gates are
in that draft stack, not the main base of this PR. This implementation writes
only user/identity/session/attempt data, never age declarations, Terms, Content
Rules or PD consent. It does not copy unaccepted legal gates or infer consents
from OAuth. After that stack is accepted, validate the combined base before
activation: the same immutable user UUID must see the ordinary server-owned
gate and no OAuth bypass. No existing gate is removed in this PR.

## Validation coverage and deferred scenarios

Unit tests cover adapter contract, redacted failures, identity validation,
response bounds, opt-in/configuration and hidden/visible UI. PostgreSQL integration
covers first/repeat/concurrent login, same-profile separation, callback replay,
state/binding/verifier mismatch, expiry, error/cancellation, incorrect Host/return
path, disabled/anonymized users, unique identity conflicts, preservation of a
Google session, production cookie flags and actual captured Pino output.
Existing Google/Telegram and payment/concurrency suites remain mandatory.

Browser E2E uses a local API with the actual adapter and in-process fake HTTP
responses. A context request starts the attempt, then browser navigation follows
the mocked provider redirect through the real cookie-bound callback and returns
to the original Wall. Refresh, logout/repeat login, replay, default absence of
routes/buttons and responsive prepared-link layout are checked. External
browser requests are intercepted/blocked; no genuine provider login is claimed.

Not validated here: a real Yandex app/account/token exchange, physical mobile
provider redirects, moderation of the OAuth app, legal approval, jurisdiction
policy, linking/unlink/recovery, creator rights and integrated #53/#54 evidence
preservation on their eventual accepted base. An unchanged pre-existing local
integration timestamp test failure was observed on an initial run; the repeat
full suite passed. These facts must remain visible in PR validation.

Perimeter multi-replica rate limits and broader auth hardening remain EGO-109
work, not implied complete by this draft. Mock PASS is insufficient to enable
login for users.

## Owner application checklist — no secrets in correspondence

1. Obtain legal approval for the applicable authorization model under part 10,
   article 8, 149-FZ and the PD purposes/recipients/localization assessment in
   EGO-74. A boolean flag does not prove compliance.
2. In [Yandex OAuth](https://oauth.yandex.ru/), create the application type for
   user authentication, not API-only access. Follow the official
   [registration guide](https://yandex.ru/dev/id/doc/ru/register-client).
   Supply truthful operator/service/domain information and obtain required app
   approval. Do not request extra permissions; review `login:info` collection.
3. Register a separate test/staging callback exactly:
   `https://api.staging.destka.online/auth/yandex/callback`. Do not reuse
   production credentials. Production callback host remains an independently
   approved deployment decision; do not invent it from `destka.ru`.
4. Store the client secret as a secret-manager value under a nonsensitive entry
   name. Use only safe names/references in GitHub, Linear and chat; do not paste
   values, screenshots of credentials or raw token responses.
5. Confirm callback registration, scopes, app ownership/terms, runtime endpoint
   reachability, proxy Host forwarding and absence of sensitive proxy logs.
6. After independent review and separate test-environment authorization, perform
   genuine first/repeat login, cancellation, replay and physical mobile smoke.
   Both flags remain false until this approval and validation are complete.
7. Separately review future Privacy/data-map/recipient/retention and Consent UX
   amendments. This PR does not edit those texts, change Google/Telegram legal
   availability or declare EGO-74/EGO-109 Done.
