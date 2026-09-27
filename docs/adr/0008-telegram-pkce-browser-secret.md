# ADR 0008: Browser-held PKCE verifier for Telegram login

## Status

Accepted.

## Context

Telegram OIDC Authorization Code login supports PKCE S256. The existing OAuth attempt model already stores hashed state, browser binding, and nonce in PostgreSQL and consumes an attempt once. Token exchange needs the original PKCE verifier, but a reusable raw verifier does not need to be stored in the database.

## Decision

Extend `oauth_login_attempts` with a nullable verifier hash. Google attempts leave it null. Telegram attempts generate a new 256-bit verifier, send only its S256 challenge in the authorization request, and place the verifier plus nonce in a ten-minute HttpOnly browser cookie. The separate browser-binding cookie remains required. The callback checks the provider, state, browser binding, verifier hash, and nonce hash before the atomic consume. After that it passes the verifier and nonce to the OIDC adapter for code exchange and ID-token validation. Both temporary cookies are cleared on callback.

## Consequences

The server needs no plaintext PKCE verifier at rest. A copied callback URL is insufficient without both browser cookies. A replaced or missing PKCE cookie fails before token exchange. Starting a second Telegram login in the same browser replaces the cookies and makes the first attempt unusable; it expires normally. Google keeps its existing flow and cannot claim an attempt containing a verifier hash.
