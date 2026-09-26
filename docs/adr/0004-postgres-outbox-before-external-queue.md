# ADR 0004: PostgreSQL outbox before an external queue

## Context

Future notifications and image processing need background delivery without weakening takeover transactions.

## Decision

Start with a PostgreSQL outbox/job mechanism processed by the worker. Bootstrap starts the worker but defines no jobs or outbox tables.

## Consequences

Events can be recorded in the same transaction as domain changes. Worker polling and retries will need explicit design when jobs arrive.

## Alternatives considered

Redis, RabbitMQ, and Kafka add infrastructure before workload or delivery requirements justify them.
