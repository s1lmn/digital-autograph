# Public repository CI/CD controls (EGO-88)

Standard GitHub-hosted runners in public repositories are free of minute charges;
keep Linux, Windows and macOS CI on the standard hosted labels. Artifact/cache
storage and larger runners have separate limits. See
[GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
An account payment restriction can still prevent a job from starting; inspect
check annotations and obtain a new successful run after the visibility change.
Old green runs do not demonstrate recovery.

## Trust boundaries

CI executes PR code, including fork/Dependabot code, only on disposable hosted
runners with an explicit contents-read token and unpersisted checkout credentials.
Only synthetic loopback DB/storage settings belong in its jobs. Cache is limited
to the pnpm store; Release neither consumes PR artifacts nor restores PR caches.
Playwright reports contain synthetic test evidence and expire after three days.
Never use real users, runtime credentials or private originals in E2E fixtures.

PR Policy uses `pull_request_target` solely to execute the base-branch inline
metadata validator. Its token has contents/pull-requests read only; it has no
checkout, repository script, shell command, external PR resource or secrets.
Never add any of those to this workflow. Payload strings remain JavaScript data,
never interpolated into executable expressions. This ensures fork edits cannot
replace the policy and metadata edits are evaluated by trusted code. Until this
workflow is merged, existing PRs still use the previous base behavior.

Before making `policy` required, the owner must also inspect the repository's
effective Actions event policy. GitHub's default public-repository policy is
currently in evaluate mode and is scheduled to enforce a block on
`pull_request_target` for affected repositories on 2 November 2026. If this
metadata-only workflow remains necessary, review an explicit allowance for this
event under the applicable policy and verify a real run after it takes effect.
Do not change settings automatically, broaden token permissions, execute PR
source, or treat a blocked/missing policy run as success. See
[GitHub's default event policy](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target#default-policy-for-pull_request_target).

Draft Policy is intentionally skipped; drafts cannot merge. `ready_for_review`
validates it again. Stacked drafts may target their documented dependency while
under development; before merge, retarget to updated `main`, complete metadata
and obtain fresh checks/review. Policy still rejects non-main merge targets.

Release accepts only successful same-repository push CI on `main`, or the
existing main-only manual path. It verifies exact checkout SHA before build and
VM execution; manual production requires RELEASE_OPERATOR, explicit APPROVED,
trusted-main ancestry, exact-SHA push CI and same-SHA staging success. Publisher
OIDC is hosted-only and registry-only; Lockbox stays on the environment VM.
Rollback preserves persistent data and uses recorded previous images. This audit
does not dispatch Release, change its authorization scheme, or certify recovery.

## Critical runner limitation: owner action required

A repository-level self-hosted runner attached to a public personal repository
is **not isolated by labels, workflow `if`, a read-only GITHUB_TOKEN or sudoers**.
A PR can change/add workflows and request those runner labels. First-time fork
approval is insufficient: returning contributors and same-repository branches
also matter. Runtime VM identity, Lockbox and Docker/root are exposed if any
untrusted job reaches this runner. Workflow tests protect reviewed configuration,
not GitHub's scheduling authorization boundary.

Do not bring the currently offline deployment runner online until the owner
chooses and verifies an enforceable isolation boundary. Options requiring a
separate reviewed/approved operational change include a private deployment
repository with a narrowly authorized exact-SHA handoff, or an organization
runner group restricted to selected trusted workflow refs where the plan supports
it. A production Environment gate alone does not prevent a malicious job from
omitting `environment:` and targeting an unrestricted runner. Do not treat the
existing checkout/sudo contract as a sandbox. See
[GitHub's secure use reference](https://docs.github.com/en/actions/reference/security/secure-use).
No runner, VM, DNS, firewall or cloud configuration is changed by this PR.

## Main ruleset: reviewed payload, not applied

`.github/security/main-ruleset.json` is the exact proposed PUT body for existing
ruleset `24111688`. It selects only `refs/heads/main`, has no administrator bypass,
requires one independent approval, dismisses stale approvals, resolves threads,
blocks force push/deletion and requires all six existing check contexts from the
GitHub Actions app (`integration_id=15368`). Contexts were read from successful
check runs, not inferred from workflow titles:

- `checks`
- `windows-unit`
- `windows-integration-runner`
- `macos-integration-runner`
- `e2e`
- `policy`

The two maintainers have write/admin access, so an independent reviewer exists.
Code-owner review is not additionally required: either maintainer may review;
self-approval does not count. Last-push approval is not added because requiring
another person after the only reviewer pushes a fix can deadlock a two-person
workflow. Strict required checks do require synchronizing with `main` and rerunning
CI; coordinate the existing PR queue. No merge queue event is configured.

The boundary regression accepts the existing `github-script@v7` and the v9
candidate in EGO-153 / PR #44. This PR does not upgrade the Action: its release
compatibility review and final-head CI remain in #44. Check both versions when
updating this assertion; requiring only v7 would make these otherwise separate
PRs fail CI when combined.

After owner approval, use an authenticated administrator from the reviewed
checkout (this command changes GitHub settings):

```sh
gh api --method PUT repos/s1lmn/digital-autograph/rulesets/24111688 \
  --input .github/security/main-ruleset.json
# Both reads must show the intended main selector and effective rules:
gh api repos/s1lmn/digital-autograph/rulesets/24111688
gh api repos/s1lmn/digital-autograph/rules/branches/main
```

First restore hosted Actions and verify every required check on the current PR
head/merge ref. Do not install contexts that cannot report or describe the rule
as enabled from this file alone. `policy` is case-sensitive; `CI` and `PR policy`
are not the actual check-run names. Enable this rule before accepting subsequent
merges; an independent maintainer must review this PR as well.

### Add the existing Secret Scan gate after PR #47

Do not copy/reimplement PR #47. Review its latest changes, including merge-only
history detection and narrow exceptions, resolve the outstanding review, then
merge only through the normal independently approved process. Its actual context
is `secrets` (observed successful run 38563392623). Once integrated and reporting
success on current main, append that required context to the **current live**
ruleset, preserving other owner changes. Example preparation, for review before
an approved PUT:

```sh
gh api repos/s1lmn/digital-autograph/rulesets/24111688 |
  jq '{name,target,enforcement,bypass_actors,conditions,rules} |
    (.rules[] | select(.type == "required_status_checks") |
      .parameters.required_status_checks) |=
      (map(select(.context != "secrets")) +
       [{context:"secrets",integration_id:15368}])' > /tmp/main-with-secret-scan.json
# Review /tmp/main-with-secret-scan.json before applying it with gh api --input.
```

Skipped/neutral status checks may satisfy GitHub required checks; mandatory CI
jobs must have no conditional skip or failure masking. Review exact-head evidence,
not only the overall workflow badge. The independent Secret Scan main workflow
is not a dependency of Release: do not bypass PR scanning/main protection or
assume Release waits for that separate workflow.

## Other GitHub owner settings

Enable secret scanning, push protection, private vulnerability reporting and
Dependabot security updates after reviewing their scope. These were disabled at
audit time. Verify Dependabot alerts separately; automated security updates are
a different feature. Enable fork approval for **all external contributors**;
never approve a workflow merely because a contributor previously passed CI.
Keep default token read-only and Actions PR approval disabled (already verified).
Audit approved external Actions; mutable major tags remain a supply-chain risk.
Do not enforce full-SHA pinning until compatible pins are reviewed; coordinate
existing update PRs #43–45 rather than creating competing version updates.

Public GitHub Free repositories can use Environments and required reviewers.
Currently only an unprotected staging environment exists, and Release jobs do
not reference an environment. Creating protection in Settings alone will not
protect those jobs. A future production Environment change needs independent
review and owner approval, and must preserve RELEASE_OPERATOR and same-SHA
staging checks. Adding an environment to the publisher changes its OIDC `sub`;
update/test federation restrictions deliberately, never broaden the main-only
binding to make auth work. See
[deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

## Read-only staging follow-up

Use an existing authorized operator session; do not bootstrap keys, change cloud
metadata, restart services or rerun deployment to diagnose. First collect:

```sh
systemctl is-active docker
systemctl is-active 'actions.runner.*'
sudo ss -lntp '( sport = :80 or sport = :443 )'
sudo docker ps --format '{{.Names}} {{.Status}} {{.Image}}'
sudo docker inspect --format '{{.Name}} {{.Config.Image}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' \
  $(sudo docker ps -q)
sudo cat /var/lib/digital-autograph/current-image-tag \
  /var/lib/digital-autograph/previous-image-tag
curl --connect-timeout 3 --max-time 5 -I http://127.0.0.1
curl --connect-timeout 3 --max-time 5 -I https://staging.destka.online
curl --connect-timeout 3 --max-time 5 https://api.staging.destka.online/health/ready
```

Identify the Caddy container from `docker ps`, then inspect only its bounded
recent logs locally. Do not post raw container/runner logs, environment files,
Lockbox payloads, Docker full inspect or serial-console output. Compare actual
image references with recorded current/previous SHA and GitHub deployment status.
Use the reviewed staging disk inventory if capacity symptoms recur. If no
existing administrative channel works, the owner must arrange read-only guest
access separately; RUNNING VM state and open security-group rules do not prove
guest health or identify the root cause of a TLS timeout.
