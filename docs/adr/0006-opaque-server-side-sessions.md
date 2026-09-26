# ADR 0006: Opaque server-side sessions

## Context

Web authentication needs immediate revocation, User status enforcement, and independent provider login flows.

## Decision

Use a 256-bit random opaque cookie credential and store only its SHA-256 hash in PostgreSQL. Validate each protected request against current Session and User rows. Serialize creation, rotation, and logout-all by locking the User row. Use exact trusted origins for credentialed CORS and unsafe cookie-authenticated requests.

## Consequences

PostgreSQL remains authoritative for authentication. Rotation and revocation take effect immediately. Session reads add a database query to authenticated requests. The deployment must configure web origins and keep web/API on the same site for the initial `SameSite=Lax` policy.

## Alternatives considered

JWTs complicate immediate revocation. Raw token storage exposes reusable credentials if the sessions table is read. A session cache would add another consistency surface before there is a measured need.
