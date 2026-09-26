# Project rules

- PostgreSQL and backend code are the source of truth. Frontend values never authorize price, eligibility, Slot ownership, payment status, or permissions.
- A Slot must never have two active placements. One provider payment may fulfill at most one Order; one Order may create at most one takeover.
- Payment and webhook processing must be idempotent. The future financial ledger is immutable; corrections use compensating entries.
- Original autograph uploads must never be public.
- Payment and ownership consistency take priority over analytics, notifications, and share generation.
- Changes to payment, reservation, or takeover logic require integration and concurrency tests.
- Keep `packages/domain` independent of Next.js, Fastify, Drizzle, and provider SDKs.

Details live in `docs/architecture/`, decisions in `docs/adr/`, product rules in `docs/product/`, and runbooks in `docs/operations/`.
