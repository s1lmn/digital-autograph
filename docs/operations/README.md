# Operations

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
