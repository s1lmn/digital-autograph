# Security reports

Do not put credentials, private autograph originals, private signed URLs,
payment/customer data or exploit details in public issues, PRs or Actions logs.

Use GitHub's **Security → Report a vulnerability** private reporting flow when
it is enabled. If that option is unavailable, contact a repository maintainer
through an existing private channel to arrange a private report. A public issue
is not a fallback for sensitive reports. Private reporting must be enabled by
an owner; this document does not enable it.

Include the affected commit, a safe description of impact and minimal
reproduction using synthetic data. Never attach production credentials or
customer records. There is no guaranteed response SLA or supported-release
matrix yet; report issues against current `main` and identify older deployments.

If a real credential was published, its owner must revoke/rotate it at the
provider, update the corresponding secret-manager entry and assess exposure.
Removing a file does not remove Git history or existing clones. Coordinate
history cleanup separately; never rewrite shared history during routine triage.
