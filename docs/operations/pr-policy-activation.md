# Current verified state — 23 October 2026

Main protection is active, not awaiting activation. Readback of ruleset 24111688
confirms refs/heads/main only, seven strict required checks (the five CI jobs,
policy and secrets), one approval, stale-review dismissal, resolved conversations,
no force push/deletion and no bypass. Do not overwrite it with the historical
six-check proposal in .github/security/main-ruleset.json.

Actions policy 7644 (hbfhbf) is active. Its only workflow include is
.github/workflows/pr-policy.yml, excludes are empty, and its only event rule
allows pull_request_target. No global Actions permissions were changed. Current
metadata-only PR Policy runs pass; the trusted workflow executes no PR source.

The activation matrix and API configuration were exercised on test PR63 in
October, with positive/negative, Draft/Ready and synchronize events. Current
proof and retained historical activation details are recorded in EGO-88. This
does not establish behavior after GitHub's 2 November 2026 enforcement change:
a fresh safe event, required-check association and Policy insights must be
verified then. Runner isolation remains a separate unresolved owner decision;
the deployment runner stays offline.

Everything below is the original pre-activation review record. Its NOT RUN and
BLOCKED labels describe that historical point, not current repository settings.

---

# PR Policy activation gate (EGO-88 / PR #60 review)

**BLOCKED: do not require `policy` or apply `main-ruleset.json` yet.**
The prepared ruleset is a candidate for the staged rollout, not an enabled rule.
The trusted workflow has not run from default `main`; an Actions event exception
has not been applied or tested. Local tests do not satisfy this activation gate.
No GitHub settings, merge or infrastructure changes are authorized by this review
fix. The earlier staged authorization remains conditional on independent review,
accepted merge, green main CI and live positive/negative policy evidence.

## Verified configuration, 15 October 2026

- PR #60 and remote branch still had head `57e6521fb163ce2668af1bf8eb137c6199d5573c`
  before these fixes. No new GitHub reviews or inline comments existed; this
  follow-up addresses the owner's supplied technical review. EGO-88 is In Review
  in Linear; this does not mean accepted or Done.
- `GET /repos/s1lmn/digital-autograph/actions/policies?has_parents=true&per_page=100`,
  API version `2026-03-10`: HTTP 200, `total_count=0`, `policies=[]`. Repository is
  public, owned by a user, and the authenticated account has admin permission.
  Actions General `allowed_actions=all` is a different setting, not an event policy.
- GitHub documents a default block of `pull_request_target` in affected public
  repositories, with enforcement starting **2 November 2026** for the described
  pre-GA cohort. The empty API response establishes no visible applicable explicit
  exception, but does not identify this repository's future rollout cohort or
  prove that the default will never apply. Treat post-deadline operation as
  unverified, not compatible merely because CI works today.
- Historic `PR Policy` run 38563392340 used **pull_request**, not the new trigger.
  Its successful check run 115849867545 is named `policy`, from GitHub Actions app
  id 15368 (`github-actions`). This verifies historical spelling/source only.
  The five CI checks at PR #60's old head use the same app id. It does not prove
  that the new target workflow will satisfy a required check on a future PR.

References: [securely using pull_request_target](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target),
[Actions policies](https://docs.github.com/en/actions/concepts/about-actions-policies),
[workflow execution controls](https://docs.github.com/en/actions/how-tos/administer/control-workflow-execution),
[policy API schema](https://docs.github.com/en/rest/actions/policies#create-a-repository-actions-policy).

## Why retain this event for this narrow workflow?

`pull_request` safely executes untrusted source on disposable hosted runners,
which is appropriate for CI. Its policy YAML/script can also be changed by the
PR, so it does not provide trusted metadata validation. Relying on peer review
alone to detect that change weakens the independent metadata gate requested here.
A separate `workflow_run` validator would need a way to publish a PR-bound result;
adding write-capable checks/status credentials or a new external GitHub App is
outside this task. Required-workflow governance would require separate platform
and account support, not a replacement available in this personal repository.

Retain `pull_request_target` only for the default-branch inline metadata script:
no checkout, PR source execution, downloads, caches, artifacts, shell, runtime
secrets, OIDC, deployment identity or write permissions. `contents: read` and
`pull-requests: read` are explicit. Metadata comes from the webhook as data; it is
never interpolated into the executable script or evaluated. The concurrency key
uses only the numeric PR id and cancels obsolete runs. This does not turn PR CI
into a trusted or privileged workflow.

## REQUIRES OWNER ACTION: a single-path event exception

GitHub's published repository-policy API supports a `workflow_path` condition.
The read endpoint is available in this public personal repository. Prepared
`.github/security/pr-policy-event-policy.json` targets exactly
`.github/workflows/pr-policy.yml` and allows only `pull_request_target`. It adds
no actor rule, other workflow path, wildcard, checkout flag or extra event.
Creating it and future enforcement are **NOT RUN**; schema compatibility is not
proof of effective server enforcement.

Before any separately approved settings change, capture the full live policy
list with parents and read every listed policy through its `_links.self.href`.
Respect pagination and inherited restrictions. A local allow policy cannot be
assumed to override an inherited deny. Do not broaden, disable or delete existing
policies to make this file work; stop and review any interaction first.

```sh
gh api -H 'X-GitHub-Api-Version: 2026-03-10' --paginate \
  'repos/s1lmn/digital-autograph/actions/policies?has_parents=true&per_page=100'
```

After owner approval, the administrative UI route is **Settings → Actions →
Policies → New policy**. Choose an Active workflow execution policy; target only
`.github/workflows/pr-policy.yml`; restrict events to `pull_request_target`.
Do not select all workflows, add actor restrictions/lockfile requirements or
change global Actions General permissions as part of this exception. If the UI
cannot represent this exact scope, stop rather than widening it.

Alternatively, the following is the exact proposed mutation, **not executed by
this PR**. Use it only after live inspection, owner approval and review of the
payload; save the response/policy id outside the repository:

```sh
gh api --method POST -H 'X-GitHub-Api-Version: 2026-03-10' \
  repos/s1lmn/digital-autograph/actions/policies \
  --input .github/security/pr-policy-event-policy.json
# With POLICY_ID taken from the returned response, not guessed:
gh api -H 'X-GitHub-Api-Version: 2026-03-10' \
  "repos/s1lmn/digital-autograph/actions/policies/$POLICY_ID"
```

Read back and verify enforcement `active`, exact workflow include, empty exclude,
and a sole event rule allowing `pull_request_target`. Read the list with parents
again; use **Settings → Actions → Policy insights** to inspect actual/evaluated
blocking, including the default November policy. If defaults or inherited policy
still block the workflow, the gate remains BLOCKED. Do not claim a single POST
or an Evaluate result proves post-enforcement compatibility.

For recovery from event blocking: identify the failed event/path/policy in
insights and the run error, restore the reviewed exact-path policy through the
approved owner process, then edit the safe test PR's metadata to obtain a new
run. A retry does not prove new event delivery. Do not change to PR-supplied code,
allow the event for every workflow, remove required checks, disable protections
or use admin merge as recovery. If the feature/API is unavailable, preserve the
blocker and obtain owner/GitHub support resolution before requiring `policy`.

## Required live activation evidence: NOT RUN

Only after independently approved integration of #60 and successful **push CI
on its new main SHA**, use an owner-authorized harmless test PR with a documentation
change and synthetic metadata. This task does not create another PR or merge.
Do not use real credentials, exploit payloads or production data. Obtain separate
consent if using a contributor's fork/account. Record PR/run/check ids, main/head
SHAs, trigger, app id, conclusions and policy-insight results for each row:

| State/event                                             | Expected real result                                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Ready, complete template, valid issue/branch, base main | `PR Policy / policy` success                                                 |
| Remove a required heading with an `edited` event        | `policy` failure; restore metadata and obtain fresh success                  |
| Ready → `converted_to_draft`                            | `policy` failure, **not skipped/neutral**                                    |
| Draft → `ready_for_review`                              | Fresh validation; success only with valid metadata                           |
| Push a harmless branch update (`synchronize`)           | New validation associated with the current test PR/revision                  |
| Valid ready external-fork PR                            | Same trusted default-branch validator; no fork source or runtime credentials |
| Invalid external-fork metadata                          | Failure from the same trusted validator                                      |

For drafts, `pr.draft !== false` explicitly fails closed; job-level `if` was
removed. The event list includes `converted_to_draft` so an old green result
cannot remain green just because draft jobs were skipped. `ready_for_review`
restores validation. Stacked drafts may remain red until their dependency is
merged and they are retargeted to main. The five CI jobs retain their existing
scope and triggers. Cancellation must not be accepted as successful evidence.

Use the actual PR/run APIs, not a workflow badge alone:

```sh
# Substitute TEST_PR and RUN_ID from the actual harmless test.
gh api "repos/s1lmn/digital-autograph/pulls/$TEST_PR"
gh api "repos/s1lmn/digital-autograph/actions/runs/$RUN_ID"
gh api "repos/s1lmn/digital-autograph/actions/runs/$RUN_ID/jobs"
# Take check_run_url from that job and read that exact URL; verify app.id=15368.
```

`pull_request_target` runs default-branch code/SHA, unlike PR merge CI. Do not
mistake its base SHA for an exact-head CI result. Verify that the run/check is
associated with the intended PR and latest metadata/head, that historical
`policy` success cannot satisfy invalid current metadata, and that the merge UI
recognizes the context from the expected app. Until that behavior is evidenced,
the `policy` context in the candidate JSON must **not be installed as required**.
Local VM tests execute the actual inline validator for the state/event matrix
and injection-shaped strings; they do not exercise event delivery, Actions policy
enforcement, GitHub check association or branch-protection evaluation.

After the separately authorized ruleset rollout, inspect `rules/branches/main`,
the live review/check parameters and a harmless blocked test PR's merge state.
Verify missing approval and failed metadata prevent merging without attempting
an admin bypass, merging the invalid PR, force-pushing or deleting main. If the
platform reports ambiguous/skipped satisfaction, stop; do not disable a check.

## CODEOWNERS and the two-maintainer approval model

Keep the existing `require_code_owner_review: false` and one independent
write/admin approval. CODEOWNERS requests review for `.github/`, `deploy/`,
`scripts/`, `.gitleaks.toml`, SECURITY.md and operations docs, but is **not a
mandatory security-owner approval gate** with this setting. Currently the two
listed owners are also the two maintainers: requiring owner review adds little
to the eligible reviewer set. Peer review of security changes is still mandatory;
GitHub does not count the PR author's own approval. Stale approvals are dismissed
and conversations must resolve; no bypass is prepared.

This is a conscious compromise, not a claim of specialized enforced review.
Future additional write collaborators could approve without owning these paths;
revisit the model before expanding that set. If one maintainer is unavailable,
the other's own PR remains blocked; no admin/self-approval fallback is allowed.
If the sole reviewer pushes a fix, the author still cannot approve their own PR;
return authorship of fixes to the author or obtain another independent reviewer.
Do not force work through by removing rules. `require_last_push_approval` stays
false; this task does not change the approved review model.

Preserve `require_extra_approval_for_unattributed_changes: true`. Unattributed
Copilot PRs may consequently need two human approvals, as GitHub documents; this
is an existing restriction, not a newly introduced escape hatch or a reason to
turn it off. Normal human-authored PRs still need one independent approval.
