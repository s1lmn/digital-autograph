# ADR 0007: One-time, browser-bound Google login attempts

## Context

A Google authorization response contains a code that can be copied or replayed. The application needs to associate a callback with the browser that initiated login and retain no reusable provider credentials.

## Decision

Persist a ten-minute, one-time login attempt in PostgreSQL with hashes of random state, browser binding, and OIDC nonce. Send the browser binding in an HttpOnly cookie and the state/nonce to Google. Consume a matching attempt atomically before code exchange. Resolve the verified Google `sub` to a User, then issue the existing local session.

## Consequences

Concurrent callbacks cannot both succeed, and a copied callback URL alone is insufficient. A failed exchange consumes the attempt and requires a fresh start. Expired rows require later cleanup. The deployment must keep start and callback on the same API host and the web/API on the same site for `SameSite=Lax`.

## Alternatives considered

A self-contained state query parameter cannot enforce one-time consumption. Redis would add infrastructure without a current need. Storing provider tokens would create unnecessary long-lived credentials.
