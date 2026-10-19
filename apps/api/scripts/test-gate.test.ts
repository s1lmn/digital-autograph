import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ci = readFileSync(
  new URL('../../../.github/workflows/ci.yml', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');
const release = readFileSync(
  new URL('../../../.github/workflows/release.yml', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');

const mainRuleset = JSON.parse(
  readFileSync(
    new URL('../../../.github/security/main-ruleset.json', import.meta.url),
    'utf8',
  ),
);

describe('production-critical test gate', () => {
  it('targets main without bypasses and requires every current CI job plus trusted policy', () => {
    expect(mainRuleset.conditions.ref_name).toEqual({
      include: ['refs/heads/main'],
      exclude: [],
    });
    expect(mainRuleset.bypass_actors).toEqual([]);
    const required = mainRuleset.rules.find(
      (rule: { type: string }) => rule.type === 'required_status_checks',
    ).parameters;
    const ciJobs = [
      ...ci.split('jobs:')[1]!.matchAll(/^ {2}([a-z0-9-]+):\n/gm),
    ].map((match) => match[1]);
    const contexts: Array<{ context: string; integration_id: number }> =
      required.required_status_checks;
    expect(
      [...contexts].sort((a, b) => a.context.localeCompare(b.context)),
    ).toEqual(
      [...ciJobs, 'policy']
        .map((context) => ({ context, integration_id: 15368 }))
        .sort((a, b) => a.context.localeCompare(b.context)),
    );
    expect(required.strict_required_status_checks_policy).toBe(true);
    const review = mainRuleset.rules.find(
      (rule: { type: string }) => rule.type === 'pull_request',
    ).parameters;
    // Preserve the complete live review contract, including preview API fields.
    expect(review).toEqual({
      allowed_merge_methods: ['merge', 'squash', 'rebase'],
      dismiss_stale_reviews_on_push: true,
      require_code_owner_review: false,
      require_last_push_approval: false,
      required_approving_review_count: 1,
      required_review_thread_resolution: true,
      require_extra_approval_for_unattributed_changes: true,
      required_reviewers: [],
    });
    expect(mainRuleset.enforcement).toBe('active');
    expect(mainRuleset.target).toBe('branch');
    expect(
      mainRuleset.rules.map((rule: { type: string }) => rule.type).sort(),
    ).toEqual([
      'deletion',
      'non_fast_forward',
      'pull_request',
      'required_status_checks',
    ]);
    expect(required.do_not_enforce_on_create).toBe(false);
    expect(contexts.some((check) => check.context === 'secrets')).toBe(false);
  });
  it('isolates untrusted CI on hosted runners with read-only, unpersisted credentials', () => {
    expect(ci.split('jobs:')[0]).toContain('permissions:\n  contents: read');
    expect(ci).not.toMatch(
      /self-hosted|pull_request_target|workflow_run|secrets\.|id-token:|permissions:.*write/,
    );
    expect(ci.match(/uses: actions\/checkout@v7/g)).toHaveLength(5);
    expect(ci.match(/persist-credentials: false/g)).toHaveLength(5);
    expect(ci.match(/timeout-minutes:/g)).toHaveLength(5);
    expect(ci).toContain('retention-days: 3');
    expect(release).not.toMatch(/download-artifact|actions\/cache/);
  });
  it('runs macOS and Windows launcher checks alongside full Linux and Windows units', () => {
    const macos = ci
      .split('\n  macos-integration-runner:\n')[1]
      ?.split('\n  windows-integration-runner:\n')[0];
    expect(macos).toContain('runs-on: macos-latest');
    expect(macos).toContain('version: 11.19.0');
    expect(macos).toContain('node-version: 24');
    expect(macos).toContain(
      'run: pnpm test apps/api/scripts/integration-runner.test.ts apps/api/scripts/deployment-staging.posix.test.ts',
    );
    expect(macos).not.toMatch(/\bTMPDIR\s*[:=]/);
    const launcher = ci
      .split('\n  windows-integration-runner:\n')[1]
      ?.split('\n  windows-unit:\n')[0];
    expect(launcher).toContain('runs-on: windows-latest');
    expect(launcher).toContain(
      'run: pnpm test apps/api/scripts/integration-runner.test.ts',
    );
    const windows = ci
      .split('\n  windows-unit:\n')[1]
      ?.split('\n  checks:\n')[0];
    const linux = ci.split('\n  checks:\n')[1]?.split('\n  e2e:\n')[0];
    expect(windows).toContain('runs-on: windows-latest');
    expect(windows).toContain('version: 11.19.0');
    expect(windows).toContain('node-version: 24');
    expect(windows).toMatch(/^\s+- run: pnpm test$/m);
    expect(linux).toContain('runs-on: ubuntu-latest');
    expect(linux).toMatch(/^\s+- run: pnpm test$/m);
    expect(linux).not.toContain('run: pnpm test:portable');
  });
  it('keeps every critical suite in mandatory CI jobs without failure masking', () => {
    for (const command of [
      'pnpm security:audit',
      'pnpm format:check',
      'pnpm lint',
      'pnpm typecheck',
      'pnpm test',
      'pnpm test:integration',
      'pnpm build',
      'pnpm test:build-smoke',
      'pnpm test:e2e',
      'pnpm test:migration-image',
      'docker buildx bake --file deploy/docker-bake.hcl release',
    ]) {
      expect(ci).toContain(`run: ${command}\n`);
    }
    expect(ci).not.toMatch(/continue-on-error:|\|\|\s*true/);
    expect(ci).toContain('  checks:\n');
    expect(ci).toContain('  e2e:\n');
    expect(ci).not.toMatch(/\n {4}if:/);
  });
  it('requires successful exact-SHA trusted main CI for automatic and manual deploy', () => {
    expect(release).toContain(
      "github.event.workflow_run.conclusion == 'success'",
    );
    expect(release).toContain("github.event.workflow_run.event == 'push'");
    expect(release).toContain(
      'github.event.workflow_run.head_repository.full_name == github.repository',
    );
    expect(release).toContain(
      '.status == "completed" and .conclusion == "success" and .event == "push" and .headBranch == "main" and .headSha == env.IMAGE_SHA',
    );
    expect(release).toContain(
      'The selected SHA does not have a successful CI run',
    );
  });
});
