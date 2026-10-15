# Operations

[Aggregate API response metrics](api-metrics.md) documents bounded latency and
status-class events, route-template privacy, rates and sampling limitations.

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

See [staging disk recovery](staging-disk-recovery.md) for the read-only inventory
tool and the evidence required before capacity remediation and release recovery.

See [public repository CI/CD controls](public-repository-security.md) for the
main ruleset proposal, fork/runner trust boundary and remaining owner actions.

The [15 October 2026 audit](public-repository-audit-2026-10-15.md) records verified
API/network evidence, validation limits and outstanding owner actions.

[PR Policy activation](pr-policy-activation.md) records the November 2026 Actions
event-policy prerequisite, live-test gate and two-maintainer review tradeoff.
