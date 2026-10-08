#!/usr/bin/env bash
set -euo pipefail

# Administrator-owned entrypoint. No caller-selected command, path or config.
if [[ $# -ne 1 || ( "$1" != deploy && "$1" != rollback ) ]]; then
  echo "Usage: digital-autograph-preflight <deploy|rollback>" >&2
  exit 2
fi
source /etc/digital-autograph/deploy.conf
exec /usr/bin/env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  /usr/bin/node /usr/local/lib/digital-autograph/host-capacity.mjs \
  preflight "$1" /var/lib/digital-autograph /opt/digital-autograph \
  "$YC_REGISTRY_ID" "$APP_ENV"
