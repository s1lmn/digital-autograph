# Architecture boundaries

This is one modular monolith with three runtimes: Next.js web, Fastify API, and Node.js worker. PostgreSQL is the only authoritative store. `packages/domain` holds framework-independent rules. `packages/db` owns persistence and transactions; `packages/contracts` owns shared Zod API shapes; `packages/integrations` holds external adapter boundaries, starting with a private object-storage contract. Web components must not make authoritative business decisions.

The foundational schema is described in [domain-model.md](domain-model.md). Creator ownership, Wall lifecycle, visibility, and Slot structure are described in [wall-domain.md](wall-domain.md). Autograph ownership and private upload are described in [autograph-domain.md](autograph-domain.md). Placement history read models are described in [placement-history.md](placement-history.md). Payment flow belongs here as it is designed.
