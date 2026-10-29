# Autograph image processing and cleanup

## Trust and lifecycle

The API's upload reservation checks client-declared MIME type and size; completion checks S3 HEAD metadata. Neither proves image safety. Completion locks the Autograph and atomically marks the original uploaded, moves it to `uploaded_unverified`, and inserts one PostgreSQL processing job. The worker alone validates bytes and moves the Autograph through `processing` to either `awaiting_approval` or `processing_failed`. Neither outcome makes an Autograph public or usable for Placement.

## PostgreSQL jobs

`autograph_processing_jobs` is the queue. A partial unique index limits each Autograph to one `queued` or `processing` job. A worker claims one available or stale job in a transaction using `FOR UPDATE SKIP LOCKED`, increments attempts, assigns a random lease token, and moves the Autograph to `processing`. Success and failure updates require the same token and an unexpired lease. A claim older than `WORKER_LEASE_SECONDS` (default 300, bounded 60–900) can be reclaimed. A worker whose token was replaced cannot commit success or failure. At most three attempts are made; transient failures are delayed by 5, then 10 seconds. A stale third attempt becomes terminal on the next claim. Permanent validation failures are terminal immediately.

Worker polling defaults to 1000 ms (bounded 250–10000). One job and at most one abandoned upload are handled per cycle. SIGINT/SIGTERM stops new claims, wakes idle polling, and waits for the current operation before closing the database. A process killed abruptly is recovered by the lease. The lease bounds assume a 10 MB input and one concurrent image per process; tune only after measured workloads show a need.

Stable failure codes include `INVALID_IMAGE`, `UNSUPPORTED_IMAGE_FORMAT`, `IMAGE_TOO_LARGE`, `IMAGE_DIMENSIONS_EXCEEDED`, `EMPTY_AUTOGRAPH`, `STORAGE_FAILURE`, and `PROCESSING_FAILURE`. Raw exception text is not stored as user-visible state. S3 and database outages retry; malformed/unsupported/empty images do not.

## Image boundary

The worker reads private objects as a stream and enforces 10 MiB while consuming chunks, independently of HEAD and client metadata. It accepts only JPEG and PNG signatures, verifies Sharp's decoded format and declared MIME agreement, decodes one static page with warning failure, disables unlimited mode, and limits input to 20 million pixels, 10,000 pixels per side, and four channels. The dedicated worker blocks other libvips foreign loaders and unblocks JPEG, PNG, and trusted raw pixel input used internally.

Private S3 GET uses one 30-second deadline covering the entire SDK request
(including credential resolution/retries/headers) and consumption of its Node
response stream. Partial/trickling bytes do not extend it. Timeout aborts the
request, destroys the response body and rejects without waiting for a stalled
provider or stream cleanup; a response arriving after cancellation is destroyed
too. Actual received bytes still enforce the caller's finite byte limit. No
partial buffer is returned on timeout, overflow or truncated transport. The same
adapter also bounds cleaned-media reads for public Wall images; authorization
and PNG/verified-size checks remain in the existing service.

The fixed `TimeoutError` is a transient `STORAGE_FAILURE` for worker processing,
using existing lease/retry rules; public media uses its existing unavailable
response. This is an engineering resource ceiling, not a measured network SLO.
The A03 candidate separately bounds PUT/HEAD/delete/SQL and moves external work
outside transactions; see [its protocol and rollout gates](autograph-io-next-stage.md).
Image decoding retains the existing worker/image limits. Deployment
and target-provider/mobile performance acceptance remain separate. Portable
tests include real AWS SDK requests to isolated loopback HTTP servers, stalled
headers/body, single-socket recovery, exact 10 MiB and +1-byte rejection. Clock
tests cover the complete 30-second budget, delayed headers, trickle, a provider
ignoring abort and cleanup that never settles; these are synthetic failure
fixtures, not a live cloud-provider test.

EXIF orientation is applied before geometry work; decoded pixels are converted to sRGB. The photo path computes luminance, maps dark ink to alpha and white/light paper to transparent pixels, finds an ink bounding box, adds 16 transparent pixels of padding, and resizes down to at most 2048 pixels per side. The canvas path preserves RGB and alpha, crops by nontransparent pixels, pads, and resizes without the paper threshold. A minimum of eight foreground pixels or 0.001% of input pixels, whichever is larger, rejects blank input. These deterministic MVP thresholds live in `apps/worker/src/image-processing.ts`; faint pencil and uneven paper may need user review in a later editor.

Output is an 8-bit PNG, at most 2048 pixels per side and 10 MiB. Sharp's default output strips source EXIF, GPS, XMP, IPTC, and ICC metadata; no metadata-preservation call is made. The cleaned object stays in the private bucket under `autographs/<autograph-id>/cleaned/<job-id>/<lease-token>.png`. The original has a separate immutable key and is never copied into a public bucket.

## S3 and database consistency

S3 and PostgreSQL cannot commit together. Each processing lease records an immutable
attempt key before PUT. Success adopts it atomically with the cleaned Asset and job
outcome. A stale attempt cannot overwrite a successor's object. Partial cleanup
retires its own artifact before deleting outside SQL. Unadopted keys remain tracked
for repeated reconciliation, including unknown/late PUT outcomes; adopted keys are
excluded. Lost COMMIT responses are resolved by durable receipts, never by assuming
rollback and deleting an output. Succeeded jobs are not claimed again. Migration0022
also preserves legacy keys; its rollout requires draining all old writers.

Owner preview is `GET /autographs/:id/preview`. The authenticated owner receives a short-lived signed GET URL only when an uploaded cleaned Asset exists and status is `awaiting_approval` or `awaiting_moderation`. Default lifetime is 120 seconds, bounded 60–300; the response uses `Cache-Control: no-store`. The signed URL is a temporary credential and must not be logged. No original read URL or public Wall field exists. The preview response includes the owner-only cleaned Asset ID so approval can reject a derivative that differs from the one reviewed.

## Invalid and abandoned uploads

For `UPLOAD_TOO_LARGE` or `UPLOAD_METADATA_MISMATCH`, completion rejects without
an immediate DELETE: stale HEAD metadata cannot authorize deletion. The private
reserved generation stays charged until fenced expiry cleanup. The worker keeps
the existing grace (default600s, bounded60–86400), commits permanent retirement
and an exclusive key lease, deletes externally, then finalizes only the matching
unexpired token/generation. Failure/restart retains the retired reserved row and
quota. Successful finalization atomically records the original tombstone, removes
the reservation and restores draft. Completion that already owns a valid lease
prevents cleanup; a retired generation cannot complete. See the A03 protocol for
late writes, processing artifacts, finite deadlines and rollback restrictions.
