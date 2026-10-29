# A01: Deployment isolation and preserved containment

## Current checkpoint — 29 October 2026, after host containment

Full A01 remains OPEN. The owner/operator report, also recorded in EGO-109,
EGO-111, EGO-129 and EGO-164 at 15:27:50 Moscow time, supersedes the earlier
host-unknown observation below. It reports this separately authorized change:

- Exact old service `actions.runner.s1lmn-digital-autograph.da-staging-app.service`
  disabled/inactive/dead, MainPID=0; no surviving da-runner processes.
- Only da-runner removed from Docker membership; its direct Docker probe denied.
- Only `digital-autograph-runner` and `da-staging-runner` sudoers grants revoked;
  effective grant listing and harmless privileged identity probe denied.
- `visudo -c` passed; operator access retained. Five container IDs, image IDs,
  running/health states unchanged; Web/API live/ready returned 200.
- Root-only backup/evidence retained at
  `/var/lib/destka-a01-backup-20261029-runner-containment` (root, directory 0700).
  Revoked originals, hashes, manifests and first-attempt/rollback history remain.

The first attempt rolled back after a faulty interpretation of `sudo -l` exit
status. The corrected grant/refusal checks passed on the authorized reapplication;
the runner was not started during rollback. Do not conceal that history or use
an exit code alone as proof of effective privilege denial.

Independent authenticated GitHub reads in this continuation confirm runners=0,
Release `disabled_manually`, and active ruleset 24111688 with no bypass actors.
External HTTPS reads confirm staging Web, API live and ready return 200. Host
capability/container facts above are the operator's evidence, not a fresh host
audit by this source change. Deployed images remain reported release
`6847339244f2a3fde89ef1f6b95965566f109668`, not current source main.

**Preserve containment.** Do not run the historical provisioning instructions in
`runner-authorization.md` or install a new runner on the existing VM. Never
restore da-runner Docker/sudo privileges. Release, VM, IAM, credentials, DNS and
network changes each need a new explicit owner authorization. This document
authorizes no operator action.

Preserve SSH-recovery snapshot `fd80mukf0espctbvr53s` and root-only evidence;
do not delete, publish or relocate them. Snapshot storage continues to incur
charges until a separately authorized retention/deletion decision. No current
tariff or monthly amount has been verified here.

## Remaining read-only findings and evidence gaps

The earlier operator audit found the service-account metadata directory reachable
from the API container (HTTP 200); no token payload was requested. Runtime SA
`aje3f0v6ftqlvf1ubrue` has staging API/worker Lockbox payload grants and registry
pull access. Removing runner grants does not remove that application-to-cloud
credential path. Secret payloads and IAM tokens must not enter audit output.

Fresh metadata-only CLI reads in this continuation confirm the VM RUNNING with
the same attached runtime SA and snapshot `fd80mukf0espctbvr53s` READY. Direct
folder bindings are empty; the cloud-level list contains a user cloud owner.
Both staging API/worker secret resources still directly grant this runtime SA
`lockbox.payloadViewer`. The separate shop/key resources have no direct bindings.
The SA object's empty binding list describes access **to that SA**, not the SA's
effective permissions on other resources. Organization/group inheritance and
other resources were not exhaustively enumerated, so no full least-privilege
claim follows from these lists.

The attached SG still permits public TCP80/443, SSH from one operator /32 and
general IPv4 egress. This is not namespace/host-firewall/metadata isolation proof;
routes, IPv6 and effective container boundaries need independent verification.
No payload, metadata token, VM setting, IAM binding or network rule was changed.

Still unproven: effective direct/inherited cloud/folder/resource IAM, metadata
and network boundaries from each runtime identity, a new trusted deployment
identity, independent security acceptance and complete compromise history.
The retained 912-run/43-run bounded metadata triage and 23 journal deploy markers
are incomplete coverage; absent foreign-head records do not establish clearance.
Keep root-only logs/workspaces/snapshot for an independent investigation.

Next read-only audit should record resource IDs and grant scopes (including
group/inherited bindings), SG/routes and namespace reachability, identities of
runtime/deployer/publisher, retained audit/job-log coverage and evidence hashes.
Use trusted operator access and bounded metadata-only queries. Do not request
service-account tokens, read Lockbox payloads, dispatch audit workflows to the old
host, attempt hostile PR execution or infer authorization to rotate/rebuild.

## Proposed target deployment architecture — not provisioned

Keep application PR CI on disposable GitHub-hosted workers with read-only token,
no runtime secrets, cloud deployment credentials, Docker socket or private network
route. Treat same-repository PRs as untrusted too. Public repository labels and
an `if: main` inside Release are not an external authorization boundary.

Use a separately reviewed private deployment-control repository and a clean
isolated controller, with no Actions runner on the current application VM. Proposed
repository name `s1lmn/destka-deploy` is a design identifier, not an existing or
authorized resource. The controller accepts a fixed release manifest and exposes
no arbitrary shell, URL, Compose file, environment override or source checkout.
It is a privileged component requiring its own review, owner and recovery plan.

| Identity                      | Allowed scope                                                                  | Forbidden scope                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| PR CI                         | Isolated synthetic DB/storage, read source                                     | Cloud IAM, deployment API, staging/prod DB, Lockbox, runtime network                  |
| Trusted main publisher        | Push only exact release registry artifacts and provenance                      | Lockbox, VM control, DNS, IAM changes, application DB                                 |
| Staging deployment control    | Request deploy/rollback of approved digests to staging controller              | Production, secret payloads, general VM/admin API                                     |
| Production deployment control | Separate owner-approved same-digest promotion after staging evidence           | Staging credentials, arbitrary image/source/config, automatic promotion               |
| Environment controller        | Fixed local deployment/migration procedure for that environment; pull registry | PR execution, cross-environment resources, IAM/DNS/network administration             |
| Host secret renderer          | Read only exact environment secret resources into root-only files              | Folder-wide secret access, publication of payloads, CI execution                      |
| API/worker                    | Separate required DB/storage capabilities and approved mounted configuration   | Host Docker/sudo, other environment, metadata IAM credentials, general Lockbox access |

Record effective inherited permissions, not just role names. IAM roles must be
bound to specific resources where supported; an unavailable fine-grained scope
is a design blocker, not permission to grant folder editor/admin. Separate runtime
and host-renderer identities. Before acceptance, prove application containers
cannot reach metadata credentials over any supported IPv4/IPv6 path and cannot
reach Docker/control-plane/admin services. Required network/identity changes are
future separately authorized work; no current denial is claimed.

### Exact proposed workflow/ref allowlist

- Image publication: only
  `s1lmn/digital-autograph/.github/workflows/release.yml@refs/heads/main`,
  job `build_publish`, after successful same-repository CI **push** at the exact
  full main SHA and successful Secret Scan for that SHA. PR artifacts/caches are
  not promotion inputs. Pin third-party actions and verify artifact provenance
  and api/web/worker/migration digests before passing a release manifest.
- Staging control: only proposed
  `s1lmn/destka-deploy/.github/workflows/deploy-staging.yml@refs/heads/main`,
  `workflow_dispatch`, named authorized operator, staging audience/identity.
- Production control: only proposed
  `s1lmn/destka-deploy/.github/workflows/deploy-production.yml@refs/heads/main`,
  `workflow_dispatch`, separate explicit owner release approval, successful
  staging evidence for the same source SHA and exact artifact digests.
- Deny every other workflow/ref/event, including tags, forks, PR merge refs,
  `pull_request_target`, PR-origin `workflow_run` and unvalidated dispatch inputs.
  Protect deployment-repository main and workflow/controller changes with
  independent approval and current checks. Serialise operations per environment.

OIDC issuer must be `https://token.actions.githubusercontent.com`; validate
audience, expiry and exact subject. GitHub's default repository/main subject
alone does not identify the workflow. The provider or a reviewed identity broker
must enforce repository identity, exact workflow/ref and allowed event; if only
`sub` matching is available, use a tested custom subject carrying those claims.
Do not assume Yandex supports arbitrary claim predicates. Document and test the
actual claim mapping without printing tokens. If required claims cannot be
enforced, leave federation/deployment blocked. Use short-lived tokens rather than
adding long-lived cloud keys to public-repository CI.

The controller independently checks manifest signature/provenance, trusted main
ancestry, exact successful CI/Secret Scan, environment, approved digests, expiry
and a durable operation ID. Repeated requests resolve that ID, without overlapping
migrations or blind retries after an unknown outcome. Application rollback uses
the preserved compatible digest; schema/data recovery is an independently
reviewed procedure, retaining financial evidence and upload tombstones.

If organization runner groups are considered later, require both selected
repository and exact workflow/ref restrictions, proven available on the account;
they do not authorize a runner on the old VM. This alternative is not provisioned.

Acceptance needs an independent reviewer, effective IAM/network evidence, clean
controller provenance, negative allowlist tests on isolated infrastructure,
owner-approved staging release/rollback and external core-flow evidence. Keep
A01/EGO-88/EGO-164 open until those gates actually pass.

Design references checked 29 October 2026:
[GitHub secure use](https://docs.github.com/en/actions/reference/security/secure-use),
[runner workflow restrictions](https://docs.github.com/en/enterprise-cloud%40latest/actions/how-tos/manage-runners/self-hosted-runners/manage-access),
[GitHub OIDC claims](https://docs.github.com/en/actions/reference/security/oidc),
[Yandex workload identity](https://yandex.cloud/en/docs/iam/concepts/workload-identity).

## Historical registration-only update — before host containment

With explicit owner permission, only repository registration21 was detached on
27 October (idle/no jobs verified; DELETE204). Fresh authenticated GitHub reads
on29 October return runners=[] and Release disabled_manually. Host service,
Docker/sudo, credentials, metadata and effective inherited IAM remain unverified;
no trusted host operator context was identified. No host/cloud changes were made.

Retained Actions metadata:912 runs, no foreign head repository among these records.
A bounded job audit covered43 runs (all retained Release/manual runs plus ten
latest PR Policy runs),109 jobs: historical deploy jobs used runner21; selected
PR Policy jobs used ubuntu-latest. This is metadata triage, not a forensic clearance
or proof that no untrusted job ever executed. Deleted/expired logs and host state
remain outside this check. New trusted deployment identity/isolation and an
independent security sign-off are still required. The historical pre-containment
snapshot below must not be read as the current registration state.

## Historical pre-containment read-only evidence

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

## Historical owner/operator proposal — superseded by current checkpoint

Do not execute this old proposal. The current checkpoint preserves the completed
minimal containment and prohibits restoring the runner on the original VM.

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
