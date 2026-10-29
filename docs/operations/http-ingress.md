# HTTP ingress resource bounds (EGO-129)

Source-only hardening for the pinned `caddy:2.10.2-alpine`. This does not deploy
or certify a running proxy, fix runner isolation, or authorize Release.
The backend remains authoritative for upload validity, payment and ownership.

`deploy/Caddyfile` applies to both Web and API listeners:

| Bound                          | Value                                 | Purpose                                                                           |
| ------------------------------ | ------------------------------------- | --------------------------------------------------------------------------------- |
| Body                           | 10485760 bytes (exactly 10 MiB)       | Streaming ceiling, including chunked requests; no proxy body spool/buffer enabled |
| Header size                    | 32 KB (32000 bytes in adapted config) | Bounds oversized cookie/header input                                              |
| Header read                    | 10 s                                  | Incomplete headers cannot occupy a connection indefinitely                        |
| Whole request read             | 35 s                                  | Bounds slow body receipt; A02 API upload deadline is 30 s after its guards        |
| Response write                 | 45 s                                  | Bounds response lifetime, including slow readers                                  |
| Keep-alive idle                | 60 s                                  | Releases inactive connections                                                     |
| API connect / response headers | 5 s / 40 s                            | Bounds failed dial and unresponsive upstream headers                              |

These are conservative engineering limits, not a measured production SLO. A
10 MiB upload must sustain roughly 300 KiB/s to fit the ingress window. Slow
mobile/embedded browsers require physical acceptance before release. Future
long-lived streaming endpoints need a separately reviewed policy. Do not enable
blind retries for mutations. Fastify's smaller JSON body limit still applies;
provider webhook bodies do not gain upload permissions.

The proxy can forward a partial body before rejection. A02 bounds the full
body before creating an S3 write and requires metadata/size validation. Caddy
alone cannot bound API PostgreSQL waits, cluster-wide upload concurrency, total
RSS or external IO after the downstream closes; A03 remains necessary. Do not
expose API directly or add buffering to bypass these limits.

On the pinned Caddy, a read cancellation can produce an **empty implicit 200**
instead of a stable error response (the reverse proxy treats a canceled context
as a client cancellation). Therefore a proxy 2xx is not upload-completion
proof. Completion still needs authenticated backend verification of the private
object and metadata; it cannot create a Placement by itself. The smoke checks
actual stream termination and no fully received upstream body, rather than
claiming a specific status for this cancellation. A hanging upstream without
body cancellation returns 504.

## Reproducible isolated check

```sh
pnpm test:ingress
```

Requires Docker and Node 24. Starts only uniquely named synthetic Node/Caddy
containers on a temporary network; exposes one ephemeral **127.0.0.1** port,
with no application secrets, databases, cloud access or ACME provisioning.
Uses the checked-in Caddyfile and exact production timeout values. Validates the
config with the pinned image, inspects adapted bounds, sends real fixed/chunked
10 MiB and 10 MiB+1 bodies, verifies Web/header limits, real slow header/body and
API response deadlines, and health after rejection. Fixture counts complete
bodies without buffering. Temporary containers/network/files are removed in
`finally`; no shared application container is stopped.

The test takes about 45 seconds after image download and also runs in hosted CI.
It does not cover public TLS/HTTP2/HTTP3, the actual API/S3 integration, distributed
DoS, realistic upload throughput or production monitoring. Rehearse these on
approved isolated infrastructure after A01/A02/A03 and explicit deploy permission.

## Combined API check — 29.10.2026

A separate local harness combined the actual compiled API from PR78 head
`994e711c130029fe628adc56273dc8004c3e0443` (including accepted PR81/82), this
Caddyfile at `ace348ac8cf9336d6a99136e83b31f1ceb2689b1`, real isolated PostgreSQL
and private MinIO. The normal session service authenticated a seeded synthetic
session; no test-auth HTTP seam or provider credentials were used.

Passed: fixed exact10MiB204; conditional second PUT412 preserves original bytes;
unsigned original403; authenticated completion200; exact10MiB chunked at400KiB/s
(~26seconds)204 and completion; fixed/chunked +1byte413 without a stored object;
stalled body408 around30seconds without an object; unauthenticated401 and
foreign-Origin403; subsequent ready200. Temporary API/proxy, synthetic data and
owned bucket were removed. API ran natively on macOS; pinned Caddy and MinIO ran
in Docker. This is not a Linux release-image or real mobile/OAuth acceptance.
The checked-in smoke above remains the repeatable CI proxy test; retain the
combined harness/evidence with the audit checkpoint when repeating full API checks.

Official references, checked 27.10.2026:
[request_body](https://caddyserver.com/docs/caddyfile/directives/request_body),
[server options](https://caddyserver.com/docs/caddyfile/options),
[pinned reverse proxy cancellation behavior](https://github.com/caddyserver/caddy/blob/v2.10.2/modules/caddyhttp/reverseproxy/reverseproxy.go).
