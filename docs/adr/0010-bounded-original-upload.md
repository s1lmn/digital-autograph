# ADR 0010: Bound original bytes before conditional private storage writes

## Status

Proposed in EGO-109 / EGO-113; supersedes ADR 0009 on acceptance.

## Context

A presigned PUT with UNSIGNED-PAYLOAD and signed Content-Type/If-None-Match
protects the key but does not bind the actual upload size. HEAD during completion
is too late: an oversized object has already consumed persistent storage. An
account could also create unlimited drafts and refresh upload capabilities.

Yandex documents POST policies with `content-length-range`, but the supported form
conditions do not document an equivalent conditional create. AWS documents
If-None-Match for PutObject/CompleteMultipartUpload/CopyObject, not POST. A change
to POST must not silently drop no-overwrite semantics. Exact signed Content-Length
on PUT was considered; browser framing, provider enforcement and deployed provider
compatibility are not established here. None is accepted as a proven size bound.

## Decision

Use authenticated backend bounded stream ingestion, with at most 10 MiB accumulated
before **any** storage write. Reject an oversized or mismatched body without
creating an object. Keep single conditional PutObject with If-None-Match: `*`.
No new direct S3 upload credentials are issued. Keep MIME restrictions, opaque
keys and all existing authorization/processing/approval/moderation gates.

PostgreSQL serializes persisted draft/reservation quotas, charges retry attempts,
and admits at most four original I/O operations. Expired reservations retain their
charge until cleanup succeeds. Retired keys remain durable tombstones for repeated
orphan reconciliation, including unknown/late provider write outcomes.

## Consequences

The API handles byte traffic and bounded memory (up to about 80 MiB for four
10-MiB buffers plus concatenation, excluding SDK/runtime overhead). This is a
security tradeoff, not an assertion of production capacity. The existing row-lock
protocol spans bounded byte/storage I/O for A02; A03 will replace it separately
with a short-transaction/fencing protocol. Tombstones require operational monitoring
and deliberate retention acceptance. Existing direct capabilities require rollout
drain/expiry. No infrastructure or bucket permissions are changed by this decision.

Real isolated PostgreSQL/MinIO tests exercise byte enforcement, conditional writes,
privacy, expiry, quotas/races, cancellation, unknown outcomes and orphan cleanup.
A separate target-provider staging contract remains necessary before activation.

## References

- [Yandex POST policy conditions](https://yandex.cloud/en/docs/storage/concepts/presigned-post-forms)
- [Yandex conditional-write policies](https://yandex.cloud/en/docs/storage/concepts/policy)
- [AWS conditional write API coverage](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
- [Autograph protocol and caps](../architecture/autograph-domain.md)
