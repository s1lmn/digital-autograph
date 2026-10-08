# Staging runner authorization (EGO-142)

Release 37684119725 failed before mutation because the runner's existing narrow
sudoers policy did not allow the new root-shell preflight or combined helper
installation. Do not fix this with a password, `sudo -S`, unrestricted Bash/Node,
wildcard commands, SETENV or NOPASSWD ALL.

## Contract

An administrator provisions three reviewed, root-owned artifacts:

| Artifact                   | Path                                               | Mode |
| -------------------------- | -------------------------------------------------- | ---- |
| Fixed preflight entrypoint | /usr/local/sbin/digital-autograph-preflight        | 755  |
| Read-only capacity helper  | /usr/local/lib/digital-autograph/host-capacity.mjs | 644  |
| Narrow sudoers include     | /etc/sudoers.d/digital-autograph-runner            | 440  |

The entrypoint accepts exactly `deploy` or `rollback`, uses only the fixed
root-owned deploy.conf/state/release paths, and invokes `/usr/bin/node` with a
clean environment and fixed PATH. No caller-selected script/command/config is
accepted. Node.js 24 must be installed at that path. Capacity budgets, inode
guards and cached rollback completeness are unchanged.

The Release job checks both artifacts against its validated checkout before
privileged execution/config installation. Missing or changed artifacts require
an administrator refresh, including for rollback; never bypass the check.
Provisioning is required only when these infrastructure artifacts change, not
for ordinary application releases. The separately installed /opt helper still
checks capacity again inside deploy-on-vm.sh and performs post-success retention.

All workflow sudo calls use `-n`. The versioned policy permits only the fixed
preflight operations, literal existing release-file installation commands and
the deploy entrypoint with an anchored full SHA/rollback argument. It includes
the renderer+capacity-helper install command. The runner remains a trusted
main-only release identity with its pre-existing deploy/root capability; these
rules are not a sandbox for a compromised release script. No PR workflow may
run on it. The runner cannot provision or replace the administrator preflight
artifacts through this policy.

## Administrator provisioning

Apply only after independent review of this operational change. This is a
versioned provisioning action, not an ad-hoc fix or per-release workflow step.
The current script explicitly refuses production. No application restart,
Lockbox access, env/state writes, DB/storage change or release dispatch occurs.

1. Verify staging deploy.conf, Node 24 at /usr/bin/node and the da-runner account.
2. Obtain the accepted exact commit in an **administrator-controlled, root-owned
   checkout**, with all source files/parents not writable by group/others.
   Do not run privileged provisioning from the runner's writable workspace.
3. From that checkout run:

   ```bash
   sudo bash /root/digital-autograph-accepted/deploy/provision-runner-authorization.sh
   sudo visudo -c
   sudo -l -U da-runner
   ```

The script validates candidate syntax before publishing, checks the effective
sudoers include set after installation, and restores prior artifacts on failure.
It is repeatable and preserves unrelated sudoers includes; do not delete the
older runner include or unrelated policy automatically.

4. Verify entrypoint/helper match the accepted files, ownership root:root and
   modes in the table. Under the runner identity, verify `sudo -n` for each
   preflight operation and `sudo -n -l` for every literal workflow install/
   deploy command. Verify arbitrary Bash, Node, paths, extra arguments and env
   overrides remain denied. Never test an install/deploy permission by actually
   replacing the live application; use sudo's list mode for those commands.
5. Only after provisioning verification and accepted merge, allow the ordinary
   exact-main CI/automatic staging Release. Do not rerun an older workflow
   containing the rejected root-shell command.

## Regression

`pnpm test:runner-authorization` builds an isolated Ubuntu 24.04 container with
real sudo/visudo and Node 24. It reproduces old-policy denial and executes the
actual workflow's privileged command sequence for deploy/rollback without TTY.
Capacity/Docker reads and the final deployment entrypoint are synthetic fixtures;
this tests authorization, not a real DB deployment. The existing POSIX tests
exercise real deploy-on-vm.sh behavior separately.

The container has no host mounts/Docker socket, privileged mode or runtime
network. Tests check command denials, low-space mutation prevention, code drift,
ownership/modes, repeat provisioning, runner-writable source rejection,
effective-policy rollback and production provisioning refusal. CI keeps this
gate alongside full Linux/Windows/E2E/container/migration validation.
