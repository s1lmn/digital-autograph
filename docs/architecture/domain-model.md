# Foundational domain model

This describes PR #2 persistence. PostgreSQL is authoritative; no product API or business flow is implemented yet.

## Entities and relationships

| Entity         | Relationship                                                                              | Purpose                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| User           | One to many SocialIdentity, Session, ConsentRecord, Placement; zero to many owned Creator | Stable internal account, independent of social providers.                                                                      |
| SocialIdentity | Many to one User                                                                          | Provider identity; `(provider, provider_user_id)` identifies one account globally.                                             |
| Session        | Many to one User                                                                          | Future server-side session with a hashed secret and expiry/revocation.                                                         |
| ConsentRecord  | Many to one User                                                                          | Append-only evidence of the accepted document type, version, source, and time.                                                 |
| Creator        | Optional many to one User owner; one to zero or one CreatorProfile; one to many Wall      | Creator exists before account claim or verification. Ownership of several creators by one user is allowed at the schema level. |
| CreatorProfile | One to one Creator                                                                        | Public slug and display name without adding presentation fields to Creator identity.                                           |
| Wall           | Many to one Creator; one to many Slot                                                     | Wall lifecycle and intended slot count.                                                                                        |
| Slot           | Many to one Wall; one to many Placement over time                                         | Stable position and identity through ownership changes.                                                                        |
| Placement      | Many to one Slot and User                                                                 | Current holder when `ended_at IS NULL`; completed rows form history.                                                           |

`Placement → Autograph` is deferred until the Autograph domain exists. There is no placeholder ID or FK.

## IDs and time

All standalone entities use database-generated UUIDv4 via PostgreSQL `gen_random_uuid()`. CreatorProfile uses its Creator's UUID as its primary key. Test fixtures may supply deterministic UUIDs. `timestamptz` is used for every time column; PostgreSQL and the application exchange instants in UTC. Creation and linkage times default to database `now()`. Update triggers set `updated_at` for mutable entities (User, Creator, CreatorProfile, Wall). Session revocation and Placement completion times are set by the eventual domain service in a database transaction; their timing constraints are checked in PostgreSQL.

## Database guarantees and query paths

- Foreign keys prevent orphan identities, sessions, consent, profiles, walls, slots, and placements. All use `ON DELETE RESTRICT`; no historical ownership data is removed by cascading deletion.
- Unique `(provider, provider_user_id)` supports login lookup. A User may link multiple identities. Session secret hashes are unique; raw reusable session secrets are never stored.
- Unique CreatorProfile slug supports public creator lookup. Unique `(wall_id, position)` makes Slot positions deterministic within one Wall. Positions and intended `slot_count` are nonnegative.
- Placement's partial unique index on `slot_id WHERE ended_at IS NULL` prevents two active holders even under concurrent inserts. `ended_at` and nonblank `end_reason` must appear together, and end cannot precede start. A trigger allows an active Placement only to transition to completed, then rejects later updates and all deletes. Completed rows provide the full Slot/User/source/start/end/reason history; there is no duplicate history table.
- Indexes support User→identities/sessions/consent, Creator→Walls, Wall→Slots via its unique position index, Slot→Placement history and active lookup, User→Placements, and Wall status/start scheduling. Indexes do not assume future payment or reservation queries.
- ConsentRecord UPDATE/DELETE is blocked by a trigger. A new acceptance creates a new versioned row.

## Lifecycle and deletion

User status is `active`, `disabled`, or `anonymized`. Wall status is `draft`, `scheduled`, `live`, `paused`, `ended`, or `archived`. Placement source is `free_claim`, `takeover`, or `admin`. PostgreSQL enums reject values outside these sets; allowed transitions are application rules for later services. Session lifecycle is create → active → rotated/revoked/expired: `revoked_at` records explicit termination, while expiry is derived from `expires_at` and the current time. Session rotation will create a new row and revoke the old one.

User deletion should be a status/anonymization process with a retention policy; hard deletion is restricted while dependent data exists. Creator and Wall removal should use lifecycle/status transitions, with any final purge handled by an explicit retention process. Slot IDs and Placement history remain stable and are retained. SocialIdentity/Session are security records whose later retention and unlink policies need design. Consent records are retained as evidence, subject to a legal retention decision; changing an acceptance creates another row. CreatorProfile may change presentation data, but deletion of its Creator is restricted. There are no blanket `deleted_at` fields.

## Deferred application rules

The schema accepts lifecycle values but does not decide valid Wall transitions, scheduling eligibility, or who may change state. It does not require the number of Slot rows to equal `slot_count`, constrain every position to its intended range, or decide when Slot creation is allowed; the Wall service must manage those changes transactionally. Creator ownership proof and provider identity verification await Auth/Creator services. Session hashing, cookie handling, rotation, cleanup, and authorization await Auth Core. Autograph ownership linkage, free-claim eligibility, pricing, reservations, payment reconciliation, atomic takeover, and ledger entries await their respective domains.
