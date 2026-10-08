#!/usr/bin/env bash
set -euo pipefail
fail() { echo "$1" >&2; exit 1; }
printf '127.0.0.1 %s\n' "$(hostname)" >>/etc/hosts
deny() {
  if runuser -u da-runner -- sudo -n -l "$@" >/dev/null 2>&1; then fail "Unexpected sudo policy permission"; fi
  if runuser -u da-runner -- sudo -n "$@" >/dev/null 2>&1; then fail "Unexpected sudo permission"; fi
}
install -d -m 755 /etc/digital-autograph /var/lib/digital-autograph /opt/digital-autograph
printf 'APP_ENV=staging\nYC_REGISTRY_ID=registry\n' >/etc/digital-autograph/deploy.conf
chmod 640 /etc/digital-autograph/deploy.conf
printf '%040d\n' 1 >/var/lib/digital-autograph/current-image-tag
printf '%040d\n' 2 >/var/lib/digital-autograph/previous-image-tag
chmod 600 /var/lib/digital-autograph/*-image-tag
# Root-owned command fixtures: only capacity/image reads; no real deployment.
cat >/usr/local/bin/df <<'EOF'
#!/bin/bash
if [[ "$1" == --output=iavail ]]; then echo IFree; echo 1000000
else echo Avail; if [[ -e /tmp/low-space ]]; then echo 1024; else echo 20000000000; fi; fi
EOF
cat >/usr/local/bin/docker <<'EOF'
#!/bin/bash
if [[ "$1" == info ]]; then echo /; exit; fi
[[ "$1" == image && "$2" == inspect ]] || exit 1
exec /usr/bin/node -e 'console.log(JSON.stringify(process.argv.slice(1).map((ref,i)=>({Id:"sha256:"+String(i+1).padStart(64,"0"),RepoTags:[ref],Size:100000000}))))' "${@:4}"
EOF
chmod 755 /usr/local/bin/df /usr/local/bin/docker
# Exact source must be administrator-owned, not the runner checkout.
bash /root/provision/deploy/provision-runner-authorization.sh
visudo -c >/dev/null
install -d -m 755 -o da-runner -g da-runner /home/da-runner/checkout
cp -r /root/provision/deploy /home/da-runner/checkout/
cp /root/release-step.sh /home/da-runner/checkout/release-step.sh
# The workflow's existing deployment script invocation is permission-tested
# with a recording fixture; real deploy behavior has separate POSIX tests.
printf '#!/bin/bash\nprintf "%%s\\n" "$1" >/tmp/deploy-invocation\n' >/home/da-runner/checkout/deploy/deploy-on-vm.sh
chown -R da-runner:da-runner /home/da-runner/checkout

# Reproduce effective old staging policy from the read-only incident audit.
mv /etc/sudoers.d/digital-autograph-runner /root/new-policy
cat >/etc/sudoers.d/old-runner <<'EOF'
da-runner ALL=(root) NOPASSWD: /usr/bin/install -d -m 755 /opt/digital-autograph, /usr/bin/install -m 644 deploy/compose.yaml deploy/compose.staging.yaml deploy/Caddyfile /opt/digital-autograph/, /usr/bin/install -m 755 deploy/deploy-on-vm.sh /opt/digital-autograph/, /usr/bin/install -m 644 deploy/render-lockbox-env.mjs /opt/digital-autograph/, /opt/digital-autograph/deploy-on-vm.sh ^([0-9a-f]{40}|rollback)$
EOF
chmod 440 /etc/sudoers.d/old-runner
deny /bin/bash -c true
deny /usr/local/sbin/digital-autograph-preflight deploy
deny /usr/bin/install -m 644 deploy/render-lockbox-env.mjs deploy/host-capacity.mjs /opt/digital-autograph/
echo 'Old policy: new preflight and helper install rejected without TTY PASS'
mv /root/new-policy /etc/sudoers.d/digital-autograph-runner
visudo -c >/dev/null
for operation in deploy rollback; do
  runuser -u da-runner -- sudo -n /usr/local/sbin/digital-autograph-preflight "$operation"
done
deny /bin/bash -c true
deny /usr/bin/node /home/da-runner/checkout/deploy/host-capacity.mjs
deny /usr/local/sbin/digital-autograph-preflight deploy extra
deny /usr/local/sbin/digital-autograph-preflight invalid
deny /usr/bin/install -m 644 /tmp/payload /etc/sudoers
deny /opt/digital-autograph/deploy-on-vm.sh invalid
# sudo list mode checks the command, not environment assignments.
if runuser -u da-runner -- sudo -n NODE_OPTIONS=--eval=bad /usr/local/sbin/digital-autograph-preflight deploy >/dev/null 2>&1; then fail 'Runner environment override accepted'; fi
deny /root/provision/deploy/provision-runner-authorization.sh

run_step() {
  runuser -u da-runner -- /usr/bin/env GITHUB_EVENT_NAME=workflow_dispatch RELEASE_OPERATION="$1" IMAGE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    /bin/bash -c 'cd /home/da-runner/checkout && bash release-step.sh'
}
for operation in deploy rollback; do
  rm -f /tmp/deploy-invocation
  run_step "$operation"
  expected=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  [[ "$operation" == rollback ]] && expected=rollback
  [[ "$(cat /tmp/deploy-invocation)" == "$expected" ]]
done
echo 'Actual workflow privileged command sequence: deploy/rollback without TTY PASS'
rm /tmp/deploy-invocation
before=$(find /opt/digital-autograph -maxdepth 1 -type f -printf '%f %T@ %s\n' | sort)
touch /tmp/low-space
if run_step deploy >/dev/null 2>&1; then fail 'Low-space preflight accepted'; fi
[[ ! -e /tmp/deploy-invocation ]]
[[ "$before" == "$(find /opt/digital-autograph -maxdepth 1 -type f -printf '%f %T@ %s\n' | sort)" ]]
rm /tmp/low-space
printf '\n// drift\n' >>/home/da-runner/checkout/deploy/host-capacity.mjs
if run_step deploy >/dev/null 2>&1; then fail 'Provisioning drift accepted'; fi
[[ ! -e /tmp/deploy-invocation ]]
echo 'Permission denials, low-capacity guard and provisioning drift fail closed PASS'
# Administrator cannot provision from a runner-writable source checkout.
if bash /home/da-runner/checkout/deploy/provision-runner-authorization.sh >/dev/null 2>&1; then fail 'Runner source accepted'; fi
echo 'Runner-writable provisioning source rejected PASS'
for file in /usr/local/lib/digital-autograph/host-capacity.mjs /usr/local/sbin/digital-autograph-preflight /etc/sudoers.d/digital-autograph-runner; do
  [[ "$(stat -c '%U:%G' "$file")" == root:root ]]
done
[[ "$(stat -c '%a' /etc/sudoers.d/digital-autograph-runner)" == 440 ]]
echo 'Root ownership, sudoers syntax and modes PASS'
bash /root/provision/deploy/provision-runner-authorization.sh
[[ -f /etc/sudoers.d/old-runner ]]
echo 'Idempotent provisioning preserves existing sudoers files PASS'

# A failure validating the effective include set restores every artifact.
artifacts=(/usr/local/lib/digital-autograph/host-capacity.mjs /usr/local/sbin/digital-autograph-preflight /etc/sudoers.d/digital-autograph-runner)
fingerprint=$(sha256sum "${artifacts[@]}")
cp /root/provision/deploy/host-capacity.mjs /tmp/original-helper
printf '\n// administrator update\n' >>/root/provision/deploy/host-capacity.mjs
printf 'invalid sudoers syntax !!!\n' >/etc/sudoers.d/broken
chmod 440 /etc/sudoers.d/broken
if bash /root/provision/deploy/provision-runner-authorization.sh >/dev/null 2>&1; then fail 'Broken effective policy accepted'; fi
[[ "$fingerprint" == "$(sha256sum "${artifacts[@]}")" ]]
rm /etc/sudoers.d/broken
mv /tmp/original-helper /root/provision/deploy/host-capacity.mjs
visudo -c >/dev/null
printf 'APP_ENV=production\n' >/etc/digital-autograph/deploy.conf
if bash /root/provision/deploy/provision-runner-authorization.sh >/dev/null 2>&1; then fail 'Production provisioning accepted'; fi
[[ "$fingerprint" == "$(sha256sum "${artifacts[@]}")" ]]
echo 'Failed effective-policy validation restores artifacts; production provisioning refused PASS'
