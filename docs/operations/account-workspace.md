# Account workspace

`GET /me/workspace` requires the ordinary session and returns at most 50 recent
owned autographs and 50 owned Walls, the first owned creator profile, and a
moderation navigation capability. It never returns original keys, provider IDs,
session hashes or signed media URLs. Private previews use the existing owner-
checked endpoint on explicit request. Mutation endpoints still authorize on the
server; hiding a navigation item grants no authority.

`PUT /me/profile` creates or edits the first owned creator profile. The name and
username are public on the creator page; changing the username changes its URL.
The avatar is an initial, with no external image request or new personal-data
storage. A user-row lock serializes initial creation. Slug uniqueness is enforced
by PostgreSQL; collisions roll back the whole transaction, including the creator.

No schema migration or automatic user/content backfill is needed. The reviewed
runtime allowlist adds INSERT on creators/creator_profiles and UPDATE on only
slug/display_name/updated_at of creator_profiles to da_api. Worker grants do not
change. Apply those permissions only in a separately authorized deployment of
the accepted source, before enabling the new Web/API pair. The previous staging
operation/receipt must not be replayed. Source changes alone do not update a VM.

Walls start as drafts via the existing owner API; publication is a separate
explicit action. No pricing, payment, reservation or takeover rules change.
Theme and language remain available to guests in Settings. Autograph creation
continues to require the existing session/first-use gate. Logout reloads the
workspace so private cached content is cleared.

Settings opened from the autograph editor use a separate tab. An unsubmitted
canvas/photo also registers a before-unload warning; a completed private preview
can be left safely because it is already associated with the account. Changing
preferences never submits, moderates or places an autograph.
