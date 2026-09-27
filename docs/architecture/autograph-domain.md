# Autograph domain and private originals

## Ownership and lifecycle

An authenticated User creates an Autograph with source `photo` or `canvas`. Its User ID comes only from the validated server session. The same owner may read it, initiate its original upload, and complete that upload. No public Autograph route exists. `autographs.id` is the logical identity; an object-storage key is private infrastructure data.

```text
draft → upload_pending → uploaded_unverified
```

`uploaded_unverified` proves only that the backend found an object and checked its HEAD metadata against the reservation. It does not prove that the bytes are an image or safe for display. Neither this state nor any current state authorizes a Free Claim. A later processing worker must read the original privately, check magic bytes, decode with resource limits, enforce actual size and dimensions, handle malformed or polyglot data, remove EXIF and other metadata from derivatives, and pass moderation and user approval before any `ready` state is introduced.

## Asset model

An original Asset belongs to one Autograph. A partial unique index allows at most one original Asset for each Autograph; the storage key is independently unique and nonblank. The Asset stores declared content type and size, a reservation expiry, actual HEAD size after completion, and timestamps. `reserved` and `uploaded` are storage states. Original Assets remain private even if a processed derivative is eventually published.

Storage keys are generated server-side from opaque Autograph and Asset UUIDs: `autographs/<autograph-id>/original/<asset-id>`. They contain no filename, identity-provider information, username, email, or session material. The API never returns the key. The one signed PUT URL is an upload capability, not a public or permanent read URL; request/response logging must not record it or its query signature.

## Direct upload

1. `POST /autographs` creates a draft owned by the session User.
2. `POST /autographs/:id/upload` reserves one original Asset under a PostgreSQL row lock. The request declares `image/png` or `image/jpeg` and 1–10 MiB. Repeating initiation with the same metadata refreshes the reservation and signs the same key; different metadata or an already completed upload is rejected.
3. The response returns a short-lived signed PUT URL and the required `Content-Type` and `If-None-Match: *` headers. `UPLOAD_URL_TTL_SECONDS` defaults to 300 and is bounded to 60–600. Both headers are signed. Conditional PUT prevents a replayed URL from overwriting an already stored original. The client uploads directly to private object storage.
4. `POST /autographs/:id/upload/complete` performs a backend HEAD. It rejects a missing, zero-length, oversized, mismatched-size, or mismatched-content-type object. A PostgreSQL transaction changes Asset and Autograph state together. Repeated completion returns the uploaded result; concurrent completion cannot create another original.

The declared MIME type and size, S3 Content-Type metadata, and a successful PUT are untrusted. The signed URL limits the upload route, key, headers, and time; it does not validate image bytes. Size is checked at HEAD and must be enforced again while reading bytes in the processing worker. SVG, PDF, and arbitrary binary types cannot be requested through the API.

## Bucket and access

The S3-compatible adapter signs writes and performs private HEAD/delete through server credentials. It never generates a read URL or public ACL. Local/test startup creates the configured bucket when absent and removes any bucket policy, leaving anonymous access disabled. Integration tests prove an unsigned GET cannot read an uploaded original. Staging/production must provision a private bucket and least-privilege credentials outside this repository; the app does not auto-create or mutate production buckets. S3-compatible production endpoints must use HTTPS. Credentials may come from an explicit pair or the SDK's environment/role provider chain.

The pinned local MinIO build does not implement S3 `PutBucketCors`; local/CI CORS is configured with `MINIO_API_CORS_ALLOW_ORIGIN`. A production S3 bucket's CORS policy must allow the web origin, PUT, `Content-Type`, and `If-None-Match`. CORS enables browser upload but does not grant anonymous object reads.

Expired reservations and orphan private objects remain identifiable by Asset status, `upload_expires_at`, and storage key. Cleanup and processing are separate future jobs; no cleanup worker is introduced here.

## Placement relationship

`placements.autograph_id` now has a nullable foreign key. Existing history remains valid. Future Placement creation must verify `placements.user_id = autographs.user_id` and a genuinely approved, safe `ready` state in the same authoritative workflow. This PR does not create or update Placements through the API. Public Wall and Creator reads remain unchanged and expose no original Asset data.
