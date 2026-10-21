# Takeover Reservation (EGO-98)

## Boundary

The checkout chain currently ends at `Takeover Quote → Reservation`. A Reservation is a temporary, exclusive right to continue a future checkout. It is not an Order, payment, or Placement mutation. No provider identifiers or payment states are stored here. PostgreSQL and the backend decide eligibility, target ownership, expiration, and price. The API accepts only a Quote ID and an `Idempotency-Key`; it never accepts money, Wall, Slot, target, or User values from the client.

## Quote binding and money

Every Reservation has a restrictive FK and unique constraint on `quote_id`. A Quote is one-shot: expiration and cancellation never permit another Reservation from the same Quote. The Reservation snapshot copies User, Wall, Slot, target Placement, config ID, currency, and exact `amount_minor` from the immutable Quote using `INSERT … SELECT`. A database trigger verifies that the snapshot matches the Quote on insertion. The Pricing Engine is not called, and a newer platform config or changed takeover history has no effect on this snapshot.

Creation checks that the Quote belongs to the active authenticated User; unknown and foreign IDs both yield `QUOTE_NOT_FOUND`. The Quote must still be strictly unexpired at PostgreSQL time. It must point to an existing Wall and Slot relationship, an existing target Placement in that Slot, and a valid pinned pricing config, RUB currency, and positive bounded amount. An ended target yields `QUOTE_TARGET_STALE`; it cannot be silently redirected to the new occupant.

## Exclusivity and lock order

Creation first takes a transaction advisory lock keyed by User, reads the immutable Quote, locks its Wall `FOR SHARE`, then its Slot `FOR UPDATE`, then its target Placement `FOR SHARE`. This follows the Wall → Slot order of Free Claim and serializes with Wall lifecycle updates and Placement completion. After all row-lock waits, a single PostgreSQL `clock_timestamp()` snapshot governs eligibility, cooldown, Quote expiration, stale Reservation cleanup, and the new Reservation's timestamps. The current Wall must be `live`, with `start_at <= now` and `end_at > now` when set. Guaranteed visibility is checked against the immutable pricing config referenced by the Quote. No takeover count, decay, or price calculation occurs.

Under the locked Slot, any `active` Reservation with `expires_at <= now` becomes `expired`; a partial unique index on `(slot_id) WHERE status = 'active'` is the final database guard. Only one effective active Reservation can exist per Slot. Future Placement writers and Atomic Takeover must lock Wall → Slot and re-read the active Reservation before changing ownership. The Reservation itself does not modify Placement.

## TTL and lifecycle

Default TTL is 240 seconds, bounded to 180–300 seconds independently of the Quote TTL. A successfully created Reservation may outlive its Quote. Its price remains fixed until cancellation or expiry. No background scheduler is needed for correctness: creation, read, and cancellation lazily mark elapsed active rows `expired` and preserve them as history. `active → expired` and `active → cancelled` are the only state changes. A trigger prevents snapshot mutation, resurrection, other transitions, and deletion. Cancellation is owner-only, idempotent, and frees the Slot immediately. An expired Reservation is returned as expired rather than cancelled.

## Idempotency and API

The key is trimmed and constrained to 16–128 ASCII letters, digits, `.`, `_`, `~`, or `-`. Only its SHA-256 hash is persisted, with a unique `(user_id, idempotency_key_hash)` index. Exact User + key + Quote retries return the same Reservation (`200`, versus `201` on creation), including its effective historical state. Reusing the key for another Quote returns `IDEMPOTENCY_KEY_REUSED`; using the same Quote with a new key returns `QUOTE_ALREADY_RESERVED`. A different effective active Reservation returns `SLOT_RESERVED` without revealing its owner. Database unique conflicts are mapped to these stable errors.

- `POST /takeover-reservations` with `{ "quoteId": "uuid" }` and `Idempotency-Key`.
- `GET /takeover-reservations/:id` for the owner.
- `POST /takeover-reservations/:id/cancel` with an empty body for the owner.

Responses include the authoritative `expiresAt` for future countdown display. They expose no reserving User identity or private assets. All three routes require an active session and use `Cache-Control: no-store`.

## Future payment contract

An expired or cancelled Reservation must never by itself authorize an automatic takeover, even if a provider later reports a successful or late payment. The Order/Payment/webhook implementation must re-read and validate Reservation state under the same Slot locking protocol, fail closed, and handle refund or manual resolution in that future flow. This PR has no Order, provider callback, refund, or paid Placement writer.

## Reservation admission (EGO-151)

Before a new reservation is inserted, PostgreSQL enforces one effective active
reservation per user across all Walls and at most five new reservations in a
rolling 60-second window. Cancelled, expired and consumed rows count toward
velocity; cancelling does not reset the budget. Exactly 60-second-old rows no
longer count. Rows whose `expires_at <= now` do not count as active even before
lazy cleanup. Admission uses the existing user/created-time index and immutable
reservation history; no schema or external cache is required.

A transaction advisory lock on `hashtextextended('reservation-admission:' ||
user_id, 0)` serializes creation across API instances before Wall → Slot locks.
The count and INSERT commit atomically under that lock. Admission reads other
Slots' effective state without locking or expiring their rows, preventing cross
Slot lock cycles. Cancellation and payment completion only reduce active state
and do not acquire the admission lock. Hash collisions conservatively serialize
unrelated users, but do not mix their counters. PostgreSQL time is sampled after
lock waits. Database failures fail closed and create no reservation.

Exact User/key/Quote replays are resolved before eligibility and admission checks
and return the historical row (with lazy expiry), including after a Wall pause.
Keys reused for other Quotes still fail. `USER_RESERVATION_ACTIVE` and
`RESERVATION_RATE_LIMITED` return HTTP 429, `Cache-Control: no-store`, and a
positive `Retry-After` in seconds. A user may cancel their active reservation
and retry immediately if the velocity budget permits. Existing reservation
reads/cancellation, Order creation, provider callbacks and reconciliation remain
available. A failed admission inserts no row and does not burn the Quote/key.

This is a per-account Slot-locking control, not complete anti-fraud. It does not
limit invalid request traffic, quote creation, IPs, multi-account farms or
creator self-inflation; those remain in EGO-108/EGO-109. It never bans an account.
The defaults are server-owned; changing them requires a reviewed code change.
Direct database writers must follow the admission lock protocol. Rolling deploys
must replace all old API instances before this cross-instance guarantee applies.
