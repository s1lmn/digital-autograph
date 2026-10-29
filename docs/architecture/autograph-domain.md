# Autograph domain and private originals

## Ownership and lifecycle

An authenticated User creates an Autograph with source `photo` or `canvas`. Its User ID comes only from the validated server session. The same owner may read it, initiate its original upload, and complete that upload. No public Autograph route exists. `autographs.id` is the logical identity; an object-storage key is private infrastructure data.

```text
draft → upload_pending → uploaded_unverified → processing → awaiting_approval → awaiting_moderation
                                                                          ├→ ready
                                                                          └→ moderation_rejected
                                              └──────────→ processing_failed
upload_pending (expired and abandoned) → draft
```

`uploaded_unverified` proves only that the backend found an object and checked its HEAD metadata against the reservation. The worker validates actual bytes and creates a private cleaned derivative. `awaiting_approval` does not imply user approval, moderation, public safety, or Placement eligibility. `awaiting_moderation` means the owner approved one specific cleaned derivative and submitted it for human moderation. It does not imply platform approval or Placement eligibility. `ready` means that same derivative passed human content moderation and is eligible for future placement workflows. It is still private, unplaced, and is not an identity or legal-signature verification. `moderation_rejected` is final for this MVP lifecycle; the owner may create a new Autograph.

## Owner approval gate

`GET /autographs/:id/preview` returns an owner-only short-lived signed URL and the cleaned Asset UUID in `assetId`. The canvas waits for that image to load before enabling approval. `POST /autographs/:id/approve` requires `{ "reviewedAssetId": "<UUID>" }` as a precondition describing what the owner saw, not as authority to select an asset. The backend takes the authenticated User ID from the session, locks the Autograph, selects its current uploaded cleaned Asset under a row lock, compares its ID with the reviewed ID, inserts one `autograph_user_approvals` row, and changes status to `awaiting_moderation` in the same PostgreSQL transaction. A different asset ID fails closed. A repeated call with matching persisted evidence succeeds without another insert; state/evidence disagreement fails closed.

The approval row stores `autograph_id`, `user_id`, `cleaned_asset_id`, and `approved_at`. Foreign keys use restrictive deletion and a unique Autograph index limits this MVP lifecycle to one approval. A database trigger rejects approval-row UPDATE/DELETE; another rejects mutation of an already approved cleaned Asset. The approval binds to Asset identity and cannot silently transfer to a replacement derivative. If future reprocessing produces a new cleaned Asset, it needs a deliberately new approval workflow. This PR provides no such workflow. Existing `awaiting_approval` records remain private without automatic retention cleanup.

After approval and after either moderation outcome, the owner may still request a private preview. Original upload initiation and completion are rejected, and the succeeded processing job is not requeued. User approval or moderator approval alone never makes an image public or creates a Placement. See [autograph-moderation.md](autograph-moderation.md) for the moderation evidence chain and final-state checks. Separate legal consent, if required by product policy, is outside this technical approval gate.

## Asset model

An original Asset belongs to one Autograph. Partial unique indexes allow at most one original and one cleaned Asset per Autograph; the storage key is independently unique and nonblank. Original rows retain declared type/size, reservation expiry, HEAD size, and upload timestamps. Cleaned rows instead store verified PNG type/size/dimensions and creation/upload timestamps. Role-dependent checks prohibit meaningless original-upload fields on cleaned rows. Both objects are private; the cleaned derivative has a different key and never overwrites the original.

Storage keys are generated server-side from opaque Autograph and Asset UUIDs: `autographs/<autograph-id>/original/<asset-id>`. They contain no filename, identity-provider information, username, email, or session material. The API never returns the key. The upload response contains a relative API route and Asset UUID, never a storage capability or key. Session authorization is required for every upload.

## Bounded original upload

See [ADR 0010](../adr/0010-bounded-original-upload.md). The canvas/photo UI keeps
its existing create → initiate → upload → complete → preview/approval flow.
Only the byte transport changes: credentialed PUT to the API, using the session
cookie and trusted-origin check. The original never becomes publicly readable.

1. `POST /autographs` creates an owned draft under atomic admission quotas.
2. `POST /autographs/:id/upload` reserves one original with server-generated UUID
   key and declared PNG/JPEG type/size (1–10 MiB). Matching retry returns the same
   Asset and the same expiry. Expired reservations must be cleaned before reuse.
3. The response contains `method: PUT`, relative `url:
/autographs/<id>/upload/<asset-id>`, Content-Type and expiry. It contains no S3
   credentials or signature. The browser resolves the URL against its API origin
   and includes the session cookie, including on XHR progress uploads.
4. The raw-body parser does not buffer. After authentication, legal/age gate,
   ownership, reservation/expiry and PostgreSQL I/O admission, the handler counts
   actual stream bytes up to 10 MiB. Missing/false Content-Length cannot bypass it.
   Only a complete body matching the reservation may reach the S3 adapter.
5. The backend performs a bounded single PutObject with actual ContentLength,
   expected ContentType and **If-None-Match: `*`**. The provider's conditional write
   protects an existing object; HTTP 412 means completion may recover an earlier
   successful write whose response was lost. No multipart upload is initiated.
6. Completion retains HEAD metadata validation and atomically enqueues one private
   image-processing job. Bytes remain untrusted until processing, owner approval
   and moderation. Free Claim/payment/history authorization is unchanged.

Every API instance uses the same PostgreSQL limits (engineering admission caps,
not pricing/eligibility): 100 total Autographs/account; 20 creates/account/hour;
2000 creates globally/hour; 3 reserved originals/account; 300 globally. Reserved
capacity is charged at the worst case of 10 MiB per upload (30 MiB/account,
3000 MiB globally), including expired reservations until cleanup actually succeeds.
New reservation admission also caps original Assets at 100/account, including
completed objects, so pre-existing legacy drafts cannot bypass the object budget.
Existing originals/history are preserved. A short
global advisory transaction lock serializes quota checks/insertion; no storage I/O
occurs under that quota lock. Counts come from persisted rows, with DB-clock rolling
creation windows; API restarts cannot reset quotas. Matching initiation retry does
not consume a second reservation or renew its lifetime.

A real two-pool race test admits 12 simultaneous attempts against one reservation,
verifies the persisted counter stops at five, rejects all further attempts, and
checks a foreign owner cannot consume the attempt budget.

Each reservation allows five byte-upload attempts. An atomic UPDATE charges the
attempt before external I/O; cancellation, failure and missing acknowledgement do
not refund it. Shared-capacity/lock refusals after this admission charge also consume
an attempt; clients must honor Retry-After rather than immediately loop. The
per-process pre-parser refusal happens before that charge. Initiation does not reset it. Four durable PostgreSQL lease slots
admit original byte upload/completion I/O across API processes;
four incoming byte bodies per process are admitted before parsing. Excess requests
receive 429; retry with backoff. The handler starts a 30-second abort deadline
after authentication/first-use guards and parameter parsing; it does not bound
prior PostgreSQL waits by itself. The A03 candidate adds finite shared pool,
statement/query/lock deadlines; see its protocol and rollout gates below.

S3 PUT/HEAD/delete have actual SDK abort deadlines of 10 seconds. Chunk accumulation
plus final concatenation uses at most approximately 80 MiB for four bodies, besides
runtime/SDK overhead. This is an engineering bound, not a staging capacity result.

## Failure, expiry and orphan reconciliation

A rejected or cancelled body is not forwarded to storage. The reservation remains
charged and can be retried within its expiry/attempt budget. On unknown PUT outcome,
never delete a possibly valid object or issue a replacement key immediately: retry
is conditional and completion can recover it. The A03 candidate uses short claim
and finalization transactions, exclusive key leases and generation/token fences;
external body/storage work holds no SQL connection or row lock. See
[A03](autograph-io-next-stage.md) for commit ambiguity and rollout/acceptance gates.

The worker removes abandoned reserved objects after expiry plus cleanup grace,
then atomically retires the key in `original_upload_tombstones`, removes the Asset
reservation and returns its Autograph to draft. Failed deletion preserves the
reservation for retry, without releasing quota. A fresh attempt uses a new Asset
UUID/key. Tombstones have no subject FK and survive reservation or account removal;
they contain only a private opaque key and timestamps, never original image bytes.
When there is no expired reservation to clean, the worker reconciles due tombstones,
with a one-hour backoff on success or failure. They are not discarded after one
successful DELETE: an aborted request can have a late, unknown provider outcome.
Thus a later object at a retired key stays tracked and is deleted again. Cleanup
uses one durable cleanup lease across workers. New reservation admission also caps pending reservations plus durable tombstones
at 10,000 keys globally. Reconciliation does not automatically discard this evidence;
reaching the cap fails closed for new reservations and requires an operator-reviewed
retention/reconciliation decision. Existing completion and payment recovery continue.
Persistent provider
failures, tombstone growth and cleanup lag require monitoring/privacy operations;
this PR does not claim production retention acceptance or run a cloud lifecycle job.

## Bucket and rollout

Local/test bootstrap creates a private bucket; staging/production bucket/IAM are
provisioned separately and never changed by application startup. Anonymous original
reads stay forbidden. Existing bucket PUT CORS configuration is retained for rollout
compatibility but does not authorize writes; new clients need only the API CORS
Content-Type allowance. Preview URLs remain short-lived, owner-only private read
capabilities displayed with `referrerPolicy="no-referrer"`.

Deploy API and web together only after a separately approved release. Old clients
cannot use the new session-protected URL with `credentials: omit`; they must reload.
Drain old API versions and wait at least the former maximum upload URL TTL (600s)
plus clock skew before claiming that no previously minted direct PUT remains usable.
Do not enable Release or change bucket settings as part of this code PR. A real
isolated target-provider conditional-PUT contract test is still a staging gate;
local MinIO proof does not certify the deployed provider's configuration.

## Placement relationship

`placements.autograph_id` has a nullable foreign key. Existing history remains valid. Free Claim requires `placements.user_id = autographs.user_id`, `isAutographPlacementEligible(status)`, the full approval/moderation evidence chain, and live Wall/time/eligibility rules in one authoritative transaction. Only `ready` satisfies the status predicate. The authenticated `GET /autographs?status=ready` list returns up to 30 evidence-valid owner choices with safe timestamps and source; it excludes corrupted ready rows. Public delivery serves only the approved cleaned PNG through a Placement-based API route while that Placement remains active. Original objects remain private; see [public-wall-media.md](public-wall-media.md).
