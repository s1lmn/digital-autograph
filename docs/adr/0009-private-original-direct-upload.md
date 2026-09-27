# ADR 0009: Private original direct upload

## Status

Accepted.

## Context

Original autograph photos may contain handwritten signatures and EXIF metadata. Passing image bytes through the API increases load without improving image validation. A plain object-store PUT can be replayed to overwrite an object until its URL expires.

## Decision

Keep original Assets in a private S3-compatible bucket. The authenticated API reserves an opaque key in PostgreSQL and returns a 60–600 second presigned PUT with signed `Content-Type` and `If-None-Match: *` headers. The browser writes directly to storage. Completion checks object existence and plausible HEAD metadata, then advances the Asset and Autograph together to uploaded-but-unverified. No signed GET or public derivative is available in this PR.

## Consequences

An uploaded original cannot be overwritten through a replayed signed URL. An abandoned reservation can leave a private orphan and needs later cleanup. HEAD metadata does not prove file safety; a later processing worker must inspect the bytes and create a sanitized derivative. Local MinIO uses server-level CORS configuration because its pinned build does not implement bucket-level CORS.
