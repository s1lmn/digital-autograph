import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ci = readFileSync(
  new URL('../../../.github/workflows/ci.yml', import.meta.url),
  'utf8',
);
const release = readFileSync(
  new URL('../../../.github/workflows/release.yml', import.meta.url),
  'utf8',
);

describe('production-critical test gate', () => {
  it('keeps every critical suite in mandatory CI jobs without failure masking', () => {
    for (const command of [
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
