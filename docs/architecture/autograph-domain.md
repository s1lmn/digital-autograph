# Autograph domain and private originals

## Ownership and lifecycle

An authenticated User creates an Autograph with source `photo` or `canvas`. Its User ID comes only from the validated server session. The same owner may read it, initiate its original upload, and complete that upload. No public Autograph route exists. `autographs.id` is the logical identity; an object-storage key is private infrastructure data.

```text
draft → upload_pending → uploaded_unverified → processing → awaiting_approval → awaiting_moderation
                                              └──────────→ processing_failed
upload_pending (expired and abandoned) → draft
```

`uploaded_unverified` proves only that the backend found an object and checked its HEAD metadata against the reservation. The worker validates actual bytes and creates a private cleaned derivative. `awaiting_approval` does not imply user approval, moderation, public safety, or Placement eligibility. `awaiting_moderation` means the owner approved one specific cleaned derivative and submitted it for later moderation. It does not imply platform approval, public safety, public visibility, legal validity, or Placement eligibility. No current state authorizes a Free Claim; `ready` requires later moderation rules.

## Owner approval gate

`GET /autographs/:id/preview` returns an owner-only short-lived signed URL and the cleaned Asset UUID in `assetId`. The canvas waits for that image to load before enabling approval. `POST /autographs/:id/approve` requires `{ "reviewedAssetId": "<UUID>" }` as a precondition describing what the owner saw, not as authority to select an asset. The backend takes the authenticated User ID from the session, locks the Autograph, selects its current uploaded cleaned Asset under a row lock, compares its ID with the reviewed ID, inserts one `autograph_user_approvals` row, and changes status to `awaiting_moderation` in the same PostgreSQL transaction. A different asset ID fails closed. A repeated call with matching persisted evidence succeeds without another insert; state/evidence disagreement fails closed.

The approval row stores `autograph_id`, `user_id`, `cleaned_asset_id`, and `approved_at`. Foreign keys use restrictive deletion and a unique Autograph index limits this MVP lifecycle to one approval. A database trigger rejects approval-row UPDATE/DELETE; another rejects mutation of an already approved cleaned Asset. The approval binds to Asset identity and cannot silently transfer to a replacement derivative. If future reprocessing produces a new cleaned Asset, it needs a deliberately new approval workflow. This PR provides no such workflow. Existing `awaiting_approval` records remain private without automatic retention cleanup.

After approval, the owner may still request a private preview. Original upload initiation and completion are rejected, and the succeeded processing job is not requeued. User approval alone never makes an image public or creates a Placement. Separate legal consent, if required by product policy, is outside this technical approval gate.

## Asset model

An original Asset belongs to one Autograph. Partial unique indexes allow at most one original and one cleaned Asset per Autograph; the storage key is independently unique and nonblank. Original rows retain declared type/size, reservation expiry, HEAD size, and upload timestamps. Cleaned rows instead store verified PNG type/size/dimensions and creation/upload timestamps. Role-dependent checks prohibit meaningless original-upload fields on cleaned rows. Both objects are private; the cleaned derivative has a different key and never overwrites the original.

Storage keys are generated server-side from opaque Autograph and Asset UUIDs: `autographs/<autograph-id>/original/<asset-id>`. They contain no filename, identity-provider information, username, email, or session material. The API never returns the key. The one signed PUT URL is an upload capability, not a public or permanent read URL; request/response logging must not record it or its query signature.

## Direct upload

The canvas client at `/autograph/create` uses this same upload flow. It keeps
strokes in browser memory, rasterizes a cropped transparent PNG no larger than
1200 × 600, and submits only the PNG bytes. The frontend never sends stroke
JSON or a base64 data URL. Login is checked by the browser through `/auth/me` and
Google/Telegram start links return to that fixed local path. Browser API
requests use the session cookie and the API's trusted-origin check; direct
object-storage PUT uses only the signed method, URL, and headers, with no
session credentials. `API_PUBLIC_ORIGIN` is the browser-visible API origin,
distinct from the web server's `API_INTERNAL_URL`. The local MinIO CORS origin
must match the web origin.

After completion, the client polls the owner-only status endpoint with an
abortable, bounded wait. On `awaiting_approval`, it fetches a short-lived
owner-only preview capability. The UI can request a fresh preview after expiry.
The signed preview URL is not logged by the client and is displayed with
`referrerPolicy="no-referrer"`. A failed worker job asks the user to start a new
drawing; it never marks an Autograph approved or public.

1. `POST /autographs` creates a draft owned by the session User.
2. `POST /autographs/:id/upload` reserves one original Asset under a PostgreSQL row lock. The request declares `image/png` or `image/jpeg` and 1–10 MiB. Repeating initiation with the same metadata refreshes the reservation and signs the same key; different metadata or an already completed upload is rejected.
3. The response returns a short-lived signed PUT URL and the required `Content-Type` and `If-None-Match: *` headers. `UPLOAD_URL_TTL_SECONDS` defaults to 300 and is bounded to 60–600. Both headers are signed. Conditional PUT prevents a replayed URL from overwriting an already stored original. The client uploads directly to private object storage.
4. `POST /autographs/:id/upload/complete` locks the Autograph, performs a backend HEAD, and rejects a missing, zero-length, oversized, mismatched-size, or mismatched-content-type object. Rejected oversized/mismatched objects are deleted best-effort while the lock is held; a failed deletion leaves the reserved row for eventual cleanup. A PostgreSQL transaction changes Asset and Autograph state and enqueues one processing job together. Repeated completion is idempotent until owner approval; after approval it is rejected.

The declared MIME type and size, S3 Content-Type metadata, and a successful PUT are untrusted. The signed URL limits the upload route, key, headers, and time; it does not validate image bytes. Size is checked at HEAD and must be enforced again while reading bytes in the processing worker. SVG, PDF, and arbitrary binary types cannot be requested through the API.

## Bucket and access

The S3-compatible adapter signs writes and performs private HEAD/delete through server credentials. It never generates a read URL or public ACL. Local/test startup creates the configured bucket when absent and removes any bucket policy, leaving anonymous access disabled. Integration tests prove an unsigned GET cannot read an uploaded original. Staging/production must provision a private bucket and least-privilege credentials outside this repository; the app does not auto-create or mutate production buckets. S3-compatible production endpoints must use HTTPS. Credentials may come from an explicit pair or the SDK's environment/role provider chain.

The pinned local MinIO build does not implement S3 `PutBucketCors`; local/CI CORS is configured with `MINIO_API_CORS_ALLOW_ORIGIN`. A production S3 bucket's CORS policy must allow the web origin, PUT, `Content-Type`, and `If-None-Match`. CORS enables browser upload but does not grant anonymous object reads.

The worker deletes abandoned reserved objects after `upload_expires_at` plus the configured grace period, while holding the Autograph row lock and rechecking state. Successful cleanup removes the reservation and returns the Autograph to `draft`; failed S3 deletion leaves it eligible for retry. See [autograph-processing.md](autograph-processing.md) for job leases, safety limits, and storage reconciliation.

## Placement relationship

`placements.autograph_id` now has a nullable foreign key. Existing history remains valid. Future Placement creation must verify `placements.user_id = autographs.user_id` and a genuinely approved, safe `ready` state in the same authoritative workflow. This PR does not create or update Placements through the API. Public Wall and Creator reads remain unchanged and expose no original Asset data.
