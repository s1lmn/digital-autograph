# ADR 0002: Modular monolith

## Context

Ownership and payment changes need strongly consistent operations, while web, API, and background work have different runtime needs.

## Decision

Use one deployable codebase with web, API, and worker processes. Keep domain rules independent of frameworks; do not add service-to-service domain APIs.

## Consequences

Modules can share transactions and contracts. Runtime processes still need coordinated deployment and observability later.

## Alternatives considered

Microservices would add distributed consistency and operational cost before there is a scaling need. A single Next.js process would not isolate background work.
