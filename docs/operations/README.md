# Operations

[Local image-processing benchmark](image-processing-benchmark.md) documents the
bounded synthetic processor workload, JSON measurements and capacity-test limits.

[Aggregate API response metrics](api-metrics.md) documents bounded latency and
status-class events, route-template privacy, rates and sampling limitations.
[Worker failure diagnostics](worker-diagnostics.md) documents structured,
bounded errors from image, notification and cleanup cycles.
[Local public Wall load probe](public-wall-load.md) prepares reproducible,
bounded public-read measurements for the later EGO-113 capacity exercise.

[Incident admission controls](incident-controls.md) describes independent API
shutdown of new payments and Free Claim while keeping existing recovery and
history available.

[OAuth attempt cleanup](oauth-attempt-cleanup.md) documents bounded worker
maintenance of expired Google/Telegram login attempts.

[Safe runtime diagnostics](safe-diagnostics.md) describes bounded exception
logs, request correlation and built-runtime privacy smoke checks.

Local setup is documented in the root README. See [browser E2E tests](e2e.md)
for the isolated Playwright environment and [Yandex Cloud deployment](deployment.md)
for staging/production release, migration, and rollback procedures.

See [dependency security checks](dependency-security.md) for the CI audit gate
and the targeted dependency overrides.

See [secret scanning and rotation](secret-scanning.md) for the mandatory
full-history scanner, private finding triage and credential-owner remediation.

See [staging disk recovery](staging-disk-recovery.md) for the read-only inventory
tool and the evidence required before capacity remediation and release recovery.

[Reservation admission](../architecture/takeover-reservation.md#reservation-admission-ego-151)
describes per-user protection against mass Slot locking, HTTP 429 retry behavior,
and the remaining anti-fraud work.

See [public repository CI/CD controls](public-repository-security.md) for the
main ruleset proposal, fork/runner trust boundary and remaining owner actions.

The [15 October 2026 audit](public-repository-audit-2026-10-15.md) records verified
API/network evidence, validation limits and outstanding owner actions.

[PR Policy activation](pr-policy-activation.md) records the November 2026 Actions
event-policy prerequisite, live-test gate and two-maintainer review tradeoff.
