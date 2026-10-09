# Secret scanning and rotation

`Secret Scan / secrets` is a mandatory merge gate alongside existing CI and PR
Policy. It runs on every PR (including forks/Dependabot) and main push, with a
read-only token, no production credentials, no privileged PR trigger, no reports
or finding artifacts. Checkout fetches full history and does not persist its
credential. Never merge with this gate absent, failed or stale.

Gitleaks 8.24.3 uses its built-in rules plus `.gitleaks.toml`. The Linux x64
installer checks the reviewed release archive SHA-256 before execution; download,
checksum, missing-binary, wrong-version and shallow-checkout failures block the
gate. The scanner checks all available Git refs, including deleted historical
content. It does not contact a credential provider or test whether a key is live.
Pattern matching cannot establish absence of all secrets, especially arbitrary
passwords, binaries, runtime logs or client bundles. EGO-109's wider review remains
required.

## Local check

On Linux x64:

```bash
bash scripts/install-gitleaks.sh /tmp/autograph-scanner
GITLEAKS_BIN=/tmp/autograph-scanner/gitleaks node scripts/smoke-secret-scan.mjs
GITLEAKS_BIN=/tmp/autograph-scanner/gitleaks pnpm security:secrets
```

On other systems install the official 8.24.3 binary for that OS/architecture and
verify its checksum against the official release, then set `GITLEAKS_BIN` to its
path. Use a full clone. Local scans cover committed history; they do not replace
review of staged/untracked changes before commit.

## Private triage

The gate intentionally prints only a status. An authorized developer may inspect
locations locally using the same pinned tool:

```bash
gitleaks git --config .gitleaks.toml --ignore-gitleaks-allow \
  --gitleaks-ignore-path /tmp/empty-reviewed-ignore-directory \
  --log-opts=--all --redact=100 --no-banner --verbose .
```

Create an empty ignore directory first; do not share raw source, credential
values or scanner reports in PR/Linear/chat. Redaction protects matched values,
but output can include surrounding source. Keep triage private and communicate
only the rule/location and remediation status.

For a real or uncertain credential:

1. Notify the credential owner privately with location and provider, never value.
2. Revoke/rotate at the provider and update the matching Lockbox version through
   the operator's established process; validate affected service access.
3. Review exposure/access evidence, scopes and downstream credentials. Removing
   the latest file alone is insufficient; Git history and clones retain it.
4. Coordinate history cleanup separately with the owner and both developers.
   Do not rewrite shared history or force-push main as part of routine triage.
5. Keep the gate blocked until remediation and any remaining historical finding
   are explicitly reviewed. No automatic baseline or ignore addition is allowed.

## Exceptions and scanner upgrades

Only three exact synthetic request idempotency-key values are excluded, only for
`generic-api-key`, AND only inside the reservation integration fixture path.
The original historical findings were reviewed in commit `c50bf736`. No whole
test directories, commits or baselines are skipped. Repository `.gitleaksignore`
is forbidden (its presence fails the gate), and inline `gitleaks:allow` comments
cannot suppress this gate. The explicit ignore-path flag alone does not disable
Gitleaks 8.24.3's automatic source-directory ignore loading.

Any config, installer, wrapper or workflow change requires peer review. For a
false positive record why it is synthetic and constrain the rule, exact value
and path. Verify with the real scanner that a credential in the same path and
the exempt value elsewhere still fail. For upgrades review upstream changes,
verify the published archive checksum, update the version guard and run the
smoke and full-history scan. Never weaken detection to make CI green.

Official reference: [Gitleaks 8.24.3](https://github.com/gitleaks/gitleaks/tree/v8.24.3)
and [release checksums](https://github.com/gitleaks/gitleaks/releases/tag/v8.24.3).
