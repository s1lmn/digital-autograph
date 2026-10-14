# Operations

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

[Reservation admission](../architecture/takeover-reservation.md#reservation-admission-ego-151)
describes per-user protection against mass Slot locking, HTTP 429 retry behavior,
and the remaining anti-fraud work.
