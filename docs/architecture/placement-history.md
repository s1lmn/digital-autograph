# Placement history read models

Placement history is derived directly from immutable `placements` rows;
current placements have `ended_at IS NULL`. Read paths do not introduce or
update a separate history table and do not participate in takeover, claim, or
payment writes.

`GET /walls/:id/placements` is public only while the Wall is public
(`scheduled`, `live`, `paused`, or `ended`). It returns the Slot position,
Placement source, start/end timestamps, and a safe end-reason category. It
never returns claimant IDs, Autograph IDs, Placement IDs, moderation evidence,
or storage keys. Unknown internal end reasons are mapped to `other`; only
recognized categories such as `displaced`, `wall_ended`, and `administrative`
are exposed. Responses are `no-store`.

`GET /me/placements` requires the normal authenticated session and filters in
PostgreSQL by that session's User ID. It returns only the caller's recent 100
placements, with public Wall display information and the same safe reason
category. It does not accept an arbitrary User ID. Both views order history by
`started_at` descending and use the same persisted Placement records, including
Free Claims and future takeover placements.

The public Wall includes a read-only history list. `/me/placements` presents
the current and completed placements for the signed-in User; anonymous users
are offered the existing Google and Telegram return flow. No Placement writer
or ownership rule is changed by this feature.
