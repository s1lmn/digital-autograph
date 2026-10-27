# A01: Deployment runner isolation blocker — 27 October 2026

## Read-only evidence

Repository `s1lmn/digital-autograph` is public. GitHub REST reports repository
runner ID 21, `da-staging-app`, online/idle, version 2.338.0, labels `self-hosted`,
`Linux`, `X64`, `da-staging`. Release workflow 372449280 is `disabled_manually`.
This verification did not start a workflow, deployment or cloud operation and did
not change runner/settings/permissions.

In accepted main 7d74d053371301dbfc5db7cd5023c9cd6f784b5e only `release.yml` selects
self-hosted labels: `deploy` depends on trusted-main prepare/publication, selects
staging/production labels, then invokes the root-owned preflight and privileged
release entrypoint. CI, PR Policy and Secret Scan use GitHub-hosted runners.
Two older audit/SSH workflow registrations are active in the API but their source
files are absent from current main; no new executions were requested.

Actions are enabled with all actions allowed, read-only default token and no bot
review approval. Fork approval policy is `first_time_contributors`. Actions policy
7644 only restricts events for `.github/workflows/pr-policy.yml`; it is not an
allowlist of workflows permitted to use this deployment runner. Repository runner
labels route work; neither labels nor guards inside the existing Release file
prevent a different accepted-for-execution PR workflow from selecting the runner.
Returning contributors are outside a first-time-only approval gate. No separate
trusted-workflow runner-group restriction, disposable VM isolation or removal of
cloud/host privileges was proven. No malicious workflow was run to demonstrate it.

Therefore **A01 remains a deployment/pilot blocker**. Release being disabled does
not establish that other workflows cannot target the online deployment host.
This is a confirmed exposure in configuration plus unverified isolation, not a
claim that a compromise occurred.

`main` uses active ruleset 24111688: one independent approval, stale-approval reset,
resolved review threads, strict up-to-date status checks (`checks`, `windows-unit`,
`windows-integration-runner`, `macos-integration-runner`, `e2e`, `policy`, `secrets`),
no force pushes/deletion. The legacy branch-protection endpoint's 404 must not be
reported as absent protection; effective rules come from the ruleset endpoints.

## Owner/operator action, separately authorized

1. Keep Release disabled. Record the host/service identity through the trusted
   operator console (`systemctl list-units 'actions.runner*' --all` and service
   status), not by dispatching another workflow to the suspect runner.
2. After explicit owner authorization, stop/disable the identified runner service
   and remove its repository registration. Verify REST lists it offline/absent,
   no jobs are executing/queued for it, and application services remain healthy.
   Do not invent or copy a service-unit name from an example.
3. Provision a separate trust boundary for deployment. Prefer a private deployment
   repository with no untrusted PR execution and a dedicated host. Where supported,
   an organization runner group must restrict both repositories **and exact trusted
   workflows/refs**. Repository-only registration and custom labels are insufficient.
   An alternative is disposable per-job VMs with no deployment/metadata credentials,
   no production network path or persistent privileged host state; never run
   untrusted code on the application/deployment VM.
4. Verify IAM/metadata reachability, sudo allowlist/root-owned entrypoints, network
   boundaries and approved workflow/ref restrictions from the operator console.
   Read job history for unexplained executions; rotate/rebuild only when evidence
   and owner approval call for it. Preserve forensic evidence if suspicious activity
   is found. Do not assume that an offline toggle repairs a compromised host.
5. Record proof of the new isolation without running hostile code. Only after
   independent security review and owner approval should a benign trusted staging
   release/rollback test be scheduled. Leave EGO-88/EGO-164 acceptance open until
   their actual operational criteria pass. Do not alter branch protection/checks.

Useful read-only checks:

```sh
gh api repos/s1lmn/digital-autograph/actions/runners
gh api repos/s1lmn/digital-autograph/actions/workflows/372449280
gh api repos/s1lmn/digital-autograph/actions/permissions/fork-pr-contributor-approval
gh api repos/s1lmn/digital-autograph/actions/policies
gh api repos/s1lmn/digital-autograph/rules/branches/main
```

See [GitHub's secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use)
and the existing [runner authorization contract](runner-authorization.md).
These operator steps have **not** been executed by this PR.
