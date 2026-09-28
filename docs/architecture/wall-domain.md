# Creator and Wall domain

## Ownership and boundaries

The authenticated User may manage a Creator only when `creators.owner_user_id` equals the session User ID. A null owner cannot use the ordinary owner API. The submitted Creator ID identifies the target; it is never authorization evidence. There is no admin bypass. HTTP validates requests in `packages/contracts`, `packages/walls` applies rules independently of frameworks, and `packages/db` owns SQL and transactions. The existing session guard and origin policy apply to mutations.

The public Creator read returns ID, slug, display name, and visible Wall summaries. A Creator with no profile has no public page. Owner ID, account details, roles, and internal state are omitted.

## Lifecycle

Transitions are explicit owner actions. No background scheduler changes Wall status in this MVP.

```text
draft     --schedule--> scheduled --publish--> live --pause--> paused
draft     --publish----------------------------------> live
scheduled --unschedule--> draft
live      --end--> ended --archive--> archived
paused    --resume--> live
paused    --end--> ended
```

Precisely: `draft → scheduled/live`, `scheduled → draft/live`, `live → paused/ended`, `paused → live/ended`, `ended → archived`; `archived` is terminal. Repeating an action is rejected with `INVALID_WALL_TRANSITION` (409).

`startAt` and `endAt` are optional UTC instants. If both exist, end must be later than start. Scheduling requires a future start. Publishing or resuming requires that start is not in the future and end has not passed. These checks occur when the explicit action runs. A Wall that reaches its end time remains in its current persisted state until its owner ends it; later claim eligibility must check time independently. Draft configuration can be changed; scheduled configuration can be changed while its start remains in the future. Live and later configuration cannot be edited through this API.

## Public visibility

| State     | Public Wall                | Public Creator summary |
| --------- | -------------------------- | ---------------------- |
| draft     | 404                        | Omitted                |
| scheduled | Readable                   | Included               |
| live      | Readable                   | Included               |
| paused    | Readable                   | Included               |
| ended     | Readable, historical state | Included               |
| archived  | 404                        | Omitted                |

Public Wall data includes ordered Slot IDs and positions, an occupied flag derived from an active Placement, and an active Placement ID/source/start time where present. A valid active Placement with a ready, approved Autograph also receives a relative `mediaPath` based on Placement ID; inconsistent evidence leaves it `null` without changing occupancy. It excludes User IDs, Autograph IDs, storage keys, and all Placement mutation. The public read uses one joined query without fetching object bytes. See [public-wall-media.md](public-wall-media.md).

## Slot structure and consistency

New Walls pin the explicitly activated platform pricing version when one exists; existing Walls retain their pin. An unpriced Wall still supports Free Claim. See [pricing.md](pricing.md).

Wall creation inserts the draft Wall and positions `0..slotCount-1` in one transaction. The API accepts 1–1000 Slots. `slots.id` is stable identity; `position` is ordering. Draft resize adds or removes only trailing positions, retaining every surviving Slot ID. Any Placement history blocks all structural changes, including removal of a completed Slot. Once scheduled or later, structure is locked. A read or mutation detects mismatched `slot_count`, row count, or positions and fails rather than silently returning a partial structure. PostgreSQL's unique `(wall_id, position)` index also prevents duplicate positions.

Wall mutations lock the Wall and Creator rows, then Slot rows, evaluate the rule against the locked snapshot, and update in the same transaction. Competing lifecycle actions therefore observe serial states. Free Claim locks the Wall `FOR SHARE` and the selected Slot `FOR UPDATE` in the same order. Independent Slot claims can run concurrently while Wall lifecycle updates wait. The partial unique active Placement index remains the final database guard against duplicate active placements. See [free-claim.md](free-claim.md).

The service receives actor User ID and action explicitly, leaving a clear boundary for future audit events. No audit table exists yet. Wall owner mutations do not create Placements; the separate Free Claim operation creates them under the shared lock protocol.
