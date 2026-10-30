#!/usr/bin/env bash
set -euo pipefail
# No legacy SHA-only deployment, automatic fallback, runner or cloud credential fetch.
if [[ $# -ne 3 || "$1" != --manual ]]; then
  echo 'Manual SSH deployment requires --manual prepare|apply|start /absolute/reviewed-manifest.json; legacy deploy/rollback disabled.' >&2
  exit 2
fi
exec node /opt/digital-autograph/manual-deploy.mjs "$2" "$3"
