# ADR 0001: TypeScript workspace

## Context

Web, API, and worker need shared types and validation while remaining independently runnable.

## Decision

Use strict TypeScript on Node.js 24 LTS and pnpm workspaces. Share small packages with explicit dependencies and a committed lockfile.

## Consequences

One toolchain and typecheck cover all runtimes. Workspace boundaries and import direction need review.

## Alternatives considered

Separate repositories would duplicate contracts and tooling. A single application runtime would not match the required API and worker processes.
