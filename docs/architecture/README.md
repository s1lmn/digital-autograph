# Architecture boundaries

This is one modular monolith with three runtimes: Next.js web, Fastify API, and Node.js worker. PostgreSQL is the only authoritative store. `packages/domain` holds framework-independent rules. `packages/db` owns persistence and transactions; `packages/contracts` owns shared Zod API shapes; `packages/integrations` holds external adapter boundaries, starting with a private object-storage contract. Web components must not make authoritative business decisions.

Bootstrap contains no domain schema. Detailed state machines, payment flow, and storage access rules belong here as their features are designed.
