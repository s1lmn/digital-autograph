#!/usr/bin/env bash
set -euo pipefail

# Linux x64 CI tool, verified before execution; upgrades require peer review.
destination="${1:?usage: install-gitleaks.sh DESTINATION}"
archive_sha=9991e0b2903da4c8f6122b5c3186448b927a5da4deef1fe45271c3793f4ee29c
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
curl --fail --silent --show-error --location --retry 3 \
  https://github.com/gitleaks/gitleaks/releases/download/v8.24.3/gitleaks_8.24.3_linux_x64.tar.gz \
  --output "$temporary/gitleaks.tar.gz"
printf '%s  %s\n' "$archive_sha" "$temporary/gitleaks.tar.gz" | sha256sum --check --status
tar -xzf "$temporary/gitleaks.tar.gz" -C "$temporary" gitleaks
mkdir -p "$destination"
install -m 0755 "$temporary/gitleaks" "$destination/gitleaks"
