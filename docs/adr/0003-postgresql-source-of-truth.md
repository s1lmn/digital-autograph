# ADR 0003: PostgreSQL source of truth

## Context

Slot ownership, reservations, payments, and ledger entries require transactional constraints.

## Decision

Use PostgreSQL as the authoritative database with Drizzle for schema/querying/migrations. Use raw SQL for PostgreSQL constraints and locking when needed.

## Consequences

Correctness can be enforced in database transactions. Integration tests require an isolated PostgreSQL database.

## Alternatives considered

Frontend state or object storage cannot enforce ownership invariants. An additional authoritative datastore would complicate consistency.
