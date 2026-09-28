# Free Claim and atomic Placement

## Eligibility

The ordinary authenticated, active User has one successful Free Claim per Wall. Creator ownership and administrative roles do not bypass the rule. The selected Slot must belong to the Wall and have no active Placement. The locked Wall must be `live`, with `start_at IS NULL OR start_at <= now` and `end_at IS NULL OR end_at > now`. The transaction samples PostgreSQL `clock_timestamp()` once after all row-lock waits, including Autograph and cleaned Asset verification; exact start is included and exact end is excluded. A persisted `live` status does not override an elapsed end time.

The User selects one of their own `ready` Autographs. The domain status predicate and database evidence verifier both run. The verifier requires User approval, its exact uploaded cleaned Asset, and an approved Moderation Decision on that approval and Asset. No storage read or signed URL is part of the claim transaction.

## Durable evidence and history

`wall_free_claims` records the Wall, Slot, User, Autograph, resulting Placement, and claim instant. Unique `(wall_id,user_id)` ensures one use per Wall; unique `placement_id` prevents one Placement from representing multiple claims. Restrictive foreign keys and an append-only trigger retain history. The application checks Slot-to-Wall membership under row locks; no composite foreign key is added to the existing Slot schema. The claim row survives when its Placement later ends. The same ready Autograph may be used on another Wall.

A future paid takeover will complete the current Placement, retain it as history, and create a new active Placement. It must retain the original Free Claim evidence. This PR never completes or replaces a Placement.

## Transaction and locks

1. Lock Wall `FOR SHARE` and selected Slot `FOR UPDATE`, in that order. Wall lifecycle mutations take `FOR UPDATE` on Wall before locking Slots, so pause/end and claim serialize. Multiple claims on different Slots can hold compatible Wall locks.
2. Verify Slot belongs to Wall. Check historical Free Claim for this Wall/User; exact replay returns the original claim, including after displacement or Wall end. A changed Slot or Autograph returns `FREE_CLAIM_ALREADY_USED`.
3. Check live status and active Slot occupancy. Lock the selected Autograph `FOR SHARE`, verify owner and `ready`, and verify approval, cleaned Asset, and moderation evidence. The cleaned Asset is read with `FOR SHARE`. Sample PostgreSQL time after these locks, then check Wall start/end boundaries.
4. Insert active Placement with `source=free_claim`, selected Autograph, and the captured time. Insert Free Claim evidence with the same time and Placement ID. Commit together.

The partial unique active Placement index is the final Slot guard. The unique Wall/User index is the final one-use guard for simultaneous claims on different Slots; a losing tentative Placement rolls back. SQL unique conflicts map to stable API errors. There is no reservation, distributed lock, queue, Order, or ledger entry.

## API

`POST /walls/:wallId/slots/:slotId/free-claim` requires a valid session and the standard origin guard. The strict body is `{ "autographId": "uuid" }`. A new claim returns 201 and `{claimId, wallId, slotId, autographId, placement: {id, source, startedAt}}`. An exact retry returns the same body with 200, even if the original Placement is now historical. A changed retry returns 409 `FREE_CLAIM_ALREADY_USED`. A nonclaimable Wall, occupied Slot, nonready Autograph, or inconsistent evidence returns a stable error; missing resources return 404. No client-provided price, User ID, state, or media key is accepted.

Public `GET /walls/:id` derives `occupied` and current Placement metadata from the active Placement. It does not expose claimant, Autograph ID, original or cleaned storage keys, or private preview URL. Public image delivery and claim UX are separate future work.
