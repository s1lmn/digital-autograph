# Authentication Core

PR #3 provides provider-independent, PostgreSQL-backed authentication. There is no public login or session-creation endpoint. A future Google or Telegram adapter must verify the provider assertion, resolve a User, then call `SessionService.createSession(userId)` and set the returned credential with `setSessionCookie`.

## Credential and persistence

- A credential is `da_s1_` followed by 43 URL-safe Base64 characters encoding 32 bytes from Node's cryptographic random generator. It carries no User ID or claims.
- The service stores only SHA-256 of the complete credential in `sessions.secret_hash`. The 256-bit random input makes direct SHA-256 appropriate for indexed lookup; this is not a human password. The raw credential is returned only by creation/rotation to trusted caller code and is never queried from PostgreSQL.
- The unique `sessions.secret_hash` index supports lookup. Validation joins the current User and accepts only `users.status = 'active'`, `revoked_at IS NULL`, and `expires_at` later than database time. Missing, malformed, revoked, expired, disabled, and anonymized sessions all authenticate as anonymous.
- The fixed lifetime is `SESSION_TTL_SECONDS` (local sample: 14 days; allowed range 5 minutes to 30 days). PostgreSQL generates issue and expiry times. Expiry never reactivates a session. Cleanup can be added later.

## Lifecycle and concurrency

Creation checks the User's active status in a transaction. Rotation locks the User row, revokes the old session, inserts a new independent hash, then commits. Only one concurrent rotation of the same old credential can succeed. Revoking one session is idempotent. Logout-all locks the User row and revokes all of that User's sessions, including the executing one; creation/rotation use the same lock so a concurrent rotation cannot leave an unrevoked successor. An unrelated User's sessions remain valid. This lock is for session lifecycle ordering, not a product authorization mechanism.

## Request flow and API

`@fastify/cookie` parses the cookie. One Fastify hook validates the credential through `SessionService` and stores an `anonymous` or `authenticated` typed context on the request. `/health/*` bypasses session lookup to preserve liveness. Protected routes use `requireAuthenticatedUser`; handlers do not parse or trust client-supplied User IDs. A failed guard returns `401 {"error":{"code":"UNAUTHENTICATED"}}` without disclosing why the token failed. `GET /auth/me` returns only User ID and status. `POST /auth/logout` clears the cookie and is idempotent. `POST /auth/logout-all` requires authentication and clears the cookie. Session creation and rotation are service operations for verified provider integrations, not public HTTP endpoints.

Authentication answers who the caller is. Future authorization must decide whether that User may act. Creator ownership derives from `creators.owner_user_id`; Creator is not a client-supplied role. `user_roles` stores only future moderator, finance, and admin assignments, with one row per `(user_id, role)`. No permission matrix or admin route exists yet.

## Cookie and browser controls

Production uses the host-only `__Host-da_session` cookie with `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`, and Max-Age equal to the configured lifetime. Staging also uses Secure. Local/test/development use `da_session` without Secure so plain HTTP works. Frontend JavaScript cannot read the HttpOnly cookie. Rotation's future provider-facing caller must replace the cookie with the new credential; logout endpoints clear it.

`TRUSTED_WEB_ORIGINS` is a required comma-separated list of exact HTTP(S) origins; staging and production require HTTPS entries. Credentialed CORS echoes only a configured origin, never `*`. For unsafe methods carrying a session cookie, the API requires an `Origin` in that list and returns 403 for missing or different origins before state changes. This assumes web and API are deployed on the same site (possibly different origins/ports), where `SameSite=Lax` also reduces cross-site cookie delivery. A deployment on different sites must revisit the cookie and CSRF model, likely adding a CSRF token; OAuth `state` and `nonce` belong to provider PRs.

Normal request logging contains method and URL, not Cookie headers. Fastify redacts Cookie and Authorization header paths; service and repository code never log raw credentials or hashes. API responses never include raw credentials or stored hashes.
