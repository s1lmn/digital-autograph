# Architecture boundaries

[Proposed post-publication moderation](post-publication-moderation.md) defines
future report/appeal request boundaries and the transaction/privacy/test plan;
reporting, actions and persistence are not implemented by those contracts.

[Notifications, deep links and sharing](notifications-sharing.md) describes the
durable outbox, preferences, optional Telegram channel, and public text cards.

[Baseline HTTP response security](http-security.md) documents application
headers, their compatibility boundaries and remaining pre-launch hardening.

This is one modular monolith with three runtimes: Next.js web, Fastify API, and Node.js worker. PostgreSQL is the only authoritative store. `packages/domain` holds framework-independent rules. `packages/db` owns persistence and transactions; `packages/contracts` owns shared Zod API shapes; `packages/integrations` holds external adapter boundaries, starting with a private object-storage contract. Web components must not make authoritative business decisions.

The foundational schema is described in [domain-model.md](domain-model.md). Creator ownership, Wall lifecycle, visibility, and Slot structure are described in [wall-domain.md](wall-domain.md). Autograph ownership and private upload are described in [autograph-domain.md](autograph-domain.md). Placement history read models are described in [placement-history.md](placement-history.md). Payment flow belongs here as it is designed.

[Proposed acquiring adapter boundary](payment-provider-boundary.md) prepares
EGO-100 without implementing payment orchestration, webhook effects or takeover.
