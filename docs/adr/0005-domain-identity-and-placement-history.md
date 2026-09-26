# ADR 0005: Database IDs and placement history

## Context

Core records need externally safe, stable IDs, and a Slot must retain prior holders without allowing two active holders.

## Decision

Use PostgreSQL-generated UUIDv4 for standalone entity IDs, with CreatorProfile sharing its Creator ID. Keep one Placement row per occupation period: `ended_at IS NULL` marks the active row, and completed rows are the history. Enforce active uniqueness with a PostgreSQL partial unique index, and make completed Placement rows immutable with a trigger.

## Consequences

IDs are non-sequential and available without application-side generators or extensions. Historical queries use the same rows that represented ownership. Future takeover logic must end the old Placement and create the new one in one transaction. An explicit retention and privacy strategy remains necessary for associated User data.

## Alternatives considered

UUIDv7 would improve index locality but would need additional generation support in the current PostgreSQL 17 stack. A separate history table would duplicate ownership state and require synchronized writes. A mutable `current_user_id` on Slot could diverge from Placement history.
