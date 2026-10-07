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

describe('production-critical test gate', () => {
  it('runs macOS and Windows launcher checks alongside full Linux and Windows units', () => {
    const macos = ci
      .split('\n  macos-integration-runner:\n')[1]
      ?.split('\n  windows-integration-runner:\n')[0];
    expect(macos).toContain('runs-on: macos-latest');
    expect(macos).toContain('version: 11.19.0');
    expect(macos).toContain('node-version: 24');
    expect(macos).toContain(
      'run: pnpm test apps/api/scripts/integration-runner.test.ts',
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
