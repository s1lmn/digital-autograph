#!/usr/bin/env bash
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# One-time operator action from an accepted, root-owned checkout, never a job.
[[ $EUID -eq 0 && $# -eq 0 ]] || { echo "Run as administrator without arguments" >&2; exit 2; }
source /etc/digital-autograph/deploy.conf
[[ "$APP_ENV" == staging ]] || { echo "This procedure targets staging only" >&2; exit 1; }
id -u da-runner >/dev/null
/usr/bin/node --version | grep -q '^v24\.'
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
for file in host-capacity.mjs runner-preflight.sh runner.sudoers; do
  location="$source_dir/$file"
  [[ -f "$location" && ! -L "$location" ]] || exit 1
  # Reject runner-writable source files or parents, including checkout aliases.
  while [[ "$location" != / ]]; do
    [[ ! -L "$location" && "$(stat -c '%u' "$location")" -eq 0 ]] || exit 1
    mode=$(stat -c '%a' "$location")
    (( (8#$mode & 022) == 0 )) || exit 1
    location=$(dirname -- "$location")
  done
done
/usr/sbin/visudo -cf "$source_dir/runner.sudoers" >/dev/null

targets=(/usr/local/lib/digital-autograph/host-capacity.mjs /usr/local/sbin/digital-autograph-preflight /etc/sudoers.d/digital-autograph-runner)
# Destinations and every existing parent must remain administrator-controlled.
for target in "${targets[@]}"; do
  [[ ! -e "$target" || -f "$target" ]] || exit 1
  location=$target
  while [[ "$location" != / ]]; do
    [[ ! -L "$location" ]] || exit 1
    if [[ -e "$location" ]]; then
      [[ "$(stat -c '%u' "$location")" -eq 0 ]] || exit 1
      mode=$(stat -c '%a' "$location")
      (( (8#$mode & 022) == 0 )) || exit 1
    fi
    location=$(dirname -- "$location")
  done
done
saved=$(mktemp -d)
trap 'rm -rf -- "$saved"' EXIT
for index in "${!targets[@]}"; do
  target=${targets[$index]}
  if [[ -e "$target" ]]; then cp -a -- "$target" "$saved/$index"; fi
done
committed=false
function cleanup() {
  if [[ "$committed" == false ]]; then
    for index in "${!targets[@]}"; do
      if [[ -f "$saved/$index" ]]; then
        cp -a -- "$saved/$index" "${targets[$index]}"
      else
        rm -f -- "${targets[$index]}"
      fi
    done
  fi
  rm -rf -- "$saved"
}
trap cleanup EXIT
install -d -o root -g root -m 755 /usr/local/lib/digital-autograph
install -o root -g root -m 644 "$source_dir/host-capacity.mjs" "${targets[0]}"
install -o root -g root -m 755 "$source_dir/runner-preflight.sh" "${targets[1]}"
install -o root -g root -m 440 "$source_dir/runner.sudoers" "${targets[2]}"
# Check the effective include set; on failure restore all previous artifacts.
/usr/sbin/visudo -c >/dev/null
committed=true
echo "Staging runner authorization provisioned; unrelated sudoers files preserved"
