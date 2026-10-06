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
