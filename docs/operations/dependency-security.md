# Dependency security checks

Run `pnpm security:audit` from the workspace root after a frozen-lockfile install.
The same command runs in the main CI checks job before tests and builds. It uses
`pnpm audit --audit-level high` with the project's pnpm 11.19.0 and audits the
entire workspace, including development and optional dependencies. High or
Critical advisories fail CI. Registry/network errors also fail the command:
neither `--ignore-registry-errors` nor advisory/unfixable ignores are enabled.

An advisory finding identifies a vulnerable dependency version; it does not by
itself establish that an application endpoint is exploitable. The gate uses the
registry's current advisory database and is not a container/OS scan, penetration
test, or proof that all vulnerabilities are absent. Lower-severity findings must
still be assessed; the gate threshold does not declare them safe. Container
scanning and the broader pre-launch review remain in EGO-109.

## Targeted fixes in EGO-140

The workspace overrides replace only the affected dependency ranges:

- `source-map-js <1.2.2` → `1.2.2`:
  [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
- `sharp <0.35.5` → `0.35.5`, including Next's optional image-processing copy:
  [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w).
  The API/worker already declare sharp 0.35.5; their declarations are unchanged.
- `shell-quote <1.11.0` → `1.11.0` in the development command runner:
  [GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv).
- Vitest 3's `tinypool` → `2.1.2`:
  [GHSA-5gmw-xhrv-c9v3](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3) and
  [GHSA-85c8-ppgw-ccpr](https://github.com/advisories/GHSA-85c8-ppgw-ccpr).
  This override crosses a major version because Vitest 3 still requests 1.x.
  [Tinypool 2.0](https://github.com/tinylibs/tinypool/releases/tag/v2.0.0) drops
  Node 18 support; this repository runs Node 24. Full unit and integration
  suites exercise the actual Vitest worker pool, and CI checks E2E and release
  builds as well. Recheck this override when upgrading Vitest rather than
  assuming compatibility with a future runner.

Keep the committed lockfile and overrides together. The sharp security-release
age exceptions already present in the workspace remain narrowly versioned.
Do not add broad release-age exceptions or disable package-manager protections.

## Handling a failing audit

1. Read the advisory and all dependency paths, including build/test tools and
   optional runtime packages. If the registry is unavailable, restore service
   and rerun; an outage is not a successful scan.
2. Prefer a compatible patched dependency update. Use a narrowly scoped override
   when the parent has not adopted the fix, explain it in the PR, and review the
   lockfile diff. Do not run an unrestricted auto-fix or hide an advisory merely
   to make CI green.
3. Install with the updated lockfile, rerun the audit, and run affected runtime,
   image-processing, toolchain, integration, browser and build checks. A dependency
   upgrade requires the repository's normal validation and independent review.
4. Remove an override only when upstream resolution is patched and the resulting
   frozen-lockfile install, audit and compatibility checks pass. If no patch
   exists, record the blocker and remediation in Linear; this gate has no
   automatic exemption or accepted-risk mechanism.

Command options and registry behavior are described in the
[official pnpm audit documentation](https://pnpm.io/cli/audit).

## GitHub Actions update proposals (EGO-145)

`.github/dependabot.yml` checks the workflow Actions every Monday at 09:00
Europe/Moscow. Version updates have at most three open PRs, with one dependency
per PR; `s1lmn` is assigned to triage them. Security update PRs have a separate
GitHub limit. No runtime package or container updates are configured here.

Dependabot's `reviewers` option was removed; assignment is not an approval or a
review request. The maintainer requests the other developer's review manually.
See the [GitHub options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)
and [reviewer migration notice](https://github.blog/changelog/2025-08-08-dependabot-reviewers-configuration-option-is-replaced-by-code-owners/).

For each proposal:

1. Create or select a separate ready Linear issue for that update. Add its
   identifier to the PR title/body and fill the repository PR template, including
   compatibility risks and validation. Do not reuse EGO-145 or its parent as the
   task for all subsequent upgrades.
2. Review the upstream release notes, changed workflow permissions/inputs and
   Node/runtime requirements. Dependabot's metadata is not compatibility proof.
3. Synchronize the proposal with fresh `main` using a normal merge and rerun all
   current CI and Policy jobs. Automatic rebasing is disabled to preserve review
   history; keep the existing bot branch for this PR.
4. Request an independent developer's review. Merge only after final-head CI,
   Policy, approval and blocking-thread gates pass; verify main CI and applicable
   staging release afterward before marking the update's Linear issue Done.

PR Policy permits the `dependabot/github_actions/` branch namespace only for
`dependabot[bot]` proposals in this repository. It still requires a Linear ID,
the full template, the `main` target and the existing secret-pattern checks. A
fresh bot proposal is expected to fail Policy until human triage fills these
fields. This setup adds no automatic approval, merge or metadata-writing job.

The existing `pull_request` CI uses isolated fixtures and public dependencies.
Keep its read-only token and secret boundary: do not introduce privileged
`pull_request_target` execution or copy cloud/production secrets into Dependabot
to make an update pass. See [Dependabot on GitHub Actions](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-on-actions).

As checked on 8 October 2026, GitHub's supported-version table lists pnpm v7–v10;
this workspace requires pnpm 11.19.0. npm/pnpm automation is therefore deferred
until support and a representative lockfile update are verified. Continue the
manual audit, targeted-update and frozen-lockfile process above, preserving
overrides and release-age protections. EGO-88's broader dependency-maintenance
and developer-workflow acceptance remains open.
