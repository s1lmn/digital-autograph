import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  new URL('../../../.github/workflows/release.yml', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');
function job(name: string) {
  const text = workflow
    .split(`\n  ${name}:\n`)[1]
    ?.split(/\n {2}[a-z_]+:\n/)[0];
  if (!text) throw new Error(`Missing job ${name}`);
  return text;
}
function condition(name: string) {
  const text = job(name);
  const folded = text.match(/ {4}if: >-\n((?: {6}.*\n)+)/)?.[1];
  return (
    folded?.trim().replaceAll('\n', ' ') ??
    text.match(/ {4}if: (.*)/)?.[1] ??
    'true'
  );
}
function canDeploy(
  event: string,
  operation: string,
  buildResult: string,
  prepareResult = 'success',
  cancelled = false,
) {
  const context = {
    github: { event_name: event },
    needs: {
      prepare: { result: prepareResult, outputs: { operation } },
      build_publish: { result: buildResult },
    },
    always: () => true,
    cancelled: () => cancelled,
  };
  return {
    build: Boolean(runInNewContext(condition('build_publish'), context)),
    deploy: Boolean(runInNewContext(condition('deploy'), context)),
  };
}

describe('hosted image publication and self-hosted deployment boundary', () => {
  it.each([
    [{}, true],
    [{ conclusion: 'failure' }, false],
    [{ head_branch: 'untrusted' }, false],
    [{ event: 'pull_request' }, false],
    [{ head_repository: { full_name: 'other/repo' } }, false],
  ])('only prepares a trusted successful main push %j', (changes, allowed) => {
    const context = {
      github: {
        event_name: 'workflow_run',
        repository: 'owner/repo',
        event: {
          workflow_run: {
            conclusion: 'success',
            head_branch: 'main',
            event: 'push',
            head_repository: { full_name: 'owner/repo' },
            ...changes,
          },
        },
      },
    };
    expect(Boolean(runInNewContext(condition('prepare'), context))).toBe(
      allowed,
    );
  });
  it.each([
    ['staging', 'da-staging'],
    ['production', 'da-production'],
  ])('routes %s only to %s', (target, runner) => {
    const expression = job('deploy').match(/- \$\{\{ (.*) \}\}/)?.[1];
    expect(expression).toBeTruthy();
    expect(
      runInNewContext(expression!, {
        needs: { prepare: { outputs: { target } } },
      }),
    ).toBe(runner);
  });
  it('publishes on standard hosted runners and leaves deployment on dedicated VMs', () => {
    expect(job('prepare')).toContain('runs-on: ubuntu-latest');
    expect(job('build_publish')).toContain('runs-on: ubuntu-latest');
    expect(job('deploy')).toContain(
      '- self-hosted\n      - linux\n      - x64',
    );
    expect(job('deploy')).toContain(
      "needs.prepare.outputs.target == 'production' && 'da-production' || 'da-staging'",
    );
    expect(job('build_publish')).toContain('needs: prepare');
    expect(job('deploy')).toContain('needs: [prepare, build_publish]');
  });
  it.each([
    ['workflow_run', 'deploy', 'success', true, true],
    ['workflow_run', 'deploy', 'failure', true, false],
    ['workflow_run', 'deploy', 'skipped', true, false],
    ['workflow_dispatch', 'deploy', 'skipped', false, true],
    ['workflow_dispatch', 'rollback', 'skipped', false, true],
    ['workflow_dispatch', 'deploy', 'failure', false, false],
  ])(
    'routes %s/%s after build result %s',
    (event, operation, result, build, deploy) => {
      expect(
        canDeploy(String(event), String(operation), String(result)),
      ).toEqual({ build, deploy });
    },
  );
  it('blocks unauthorized requests and cancelled deploys', () => {
    expect(canDeploy('workflow_run', 'deploy', 'success', 'failure')).toEqual({
      build: false,
      deploy: false,
    });
    expect(
      canDeploy('workflow_dispatch', 'deploy', 'skipped', 'success', true)
        .deploy,
    ).toBe(false);
  });
  it('carries the exact validated SHA through hosted checkout/publication into deployment checkout and record', () => {
    const prepare = job('prepare');
    const build = job('build_publish');
    const deploy = job('deploy');
    expect(prepare).toContain(
      'github.event.workflow_run.head_sha || inputs.image_sha',
    );
    expect(prepare).toContain(
      'image_sha: ${{ steps.request.outputs.image_sha }}',
    );
    expect(build).toContain(
      'IMAGE_SHA: ${{ needs.prepare.outputs.image_sha }}',
    );
    expect(build).toContain('ref: ${{ env.IMAGE_SHA }}');
    expect(build).toContain('git rev-parse HEAD');
    expect(build).toContain('image_sha: ${{ steps.image.outputs.sha }}');
    expect(build).toContain('echo "sha=$IMAGE_SHA"');
    expect(deploy).toContain(
      'needs.build_publish.outputs.image_sha || needs.prepare.outputs.image_sha',
    );
    expect(deploy).toContain(
      "ref: ${{ env.RELEASE_OPERATION == 'deploy' && env.IMAGE_SHA || github.sha }}",
    );
    expect(deploy).toContain('git rev-parse HEAD');
    expect(deploy).toContain('--arg ref "$IMAGE_SHA"');
  });
  it('keeps publisher OIDC/registry access in the hosted job and runtime secrets on the VM', () => {
    const build = job('build_publish');
    const deploy = job('deploy');
    expect(build).toContain('id-token: write');
    expect(build).toContain('vars.YC_SERVICE_ACCOUNT_ID');
    expect(build).toContain('--push "${missing_targets[@]}"');
    expect(build).not.toMatch(/lockbox|secrets\.|deploy-on-vm/i);
    expect(deploy).not.toMatch(
      /id-token|YC_IAM_TOKEN|YC_SERVICE_ACCOUNT_ID|ACTIONS_ID_TOKEN|docker build|buildx|--push|secrets\./,
    );
    expect(deploy).not.toContain('actions: read');
    expect(deploy).toContain(
      'sudo -n /opt/digital-autograph/deploy-on-vm.sh "$release_ref"',
    );
    expect(job('prepare')).not.toContain('id-token:');
  });
  it('keeps the main/actor/approval/exact-CI/staging authorization gates before scheduling a VM job', () => {
    const prepare = job('prepare');
    for (const gate of [
      "github.event.workflow_run.event == 'push'",
      'github.event.workflow_run.head_repository.full_name == github.repository',
      'PRODUCTION_APPROVAL" != APPROVED',
      'PRODUCTION_OPERATOR',
      'compare/$IMAGE_SHA...main',
      '.headSha == env.IMAGE_SHA',
      'deployment_sha" != "$IMAGE_SHA',
      'deployment_state" == success',
    ])
      expect(prepare).toContain(gate);
    expect(job('deploy')).toContain("needs.prepare.result == 'success'");
    expect(workflow.split('jobs:')[0]).toContain('cancel-in-progress: false');
  });
});

const deploy = readFileSync(
  new URL('../../../deploy/deploy-on-vm.sh', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');
const staging = readFileSync(
  new URL('../../../deploy/compose.staging.yaml', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');
const production = readFileSync(
  new URL('../../../deploy/compose.yaml', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');
function stepScript(name: string) {
  const section = workflow
    .split(`      - name: ${name}\n`)[1]
    ?.split('\n      - name:')[0];
  const run = section?.split('        run: |\n')[1]?.split(/\n {0,9}\S/)[0];
  if (!run) throw new Error(`Missing release step ${name}`);
  return run
    .split('\n')
    .map((line) => line.replace(/^ {10}/, ''))
    .join('\n');
}

describe('deployment configuration without POSIX execution', () => {
  it('retains legacy workflow authorization while the retired entrypoint refuses execution', () => {
    const step = stepScript('Deploy or roll back this VM');
    expect(step).toContain(
      'sudo -n /usr/local/sbin/digital-autograph-preflight "$RELEASE_OPERATION"',
    );
    expect(step).not.toContain('sudo bash');
    expect(step).toContain(
      'cmp --silent deploy/host-capacity.mjs /usr/local/lib/digital-autograph/host-capacity.mjs',
    );
    expect(step).toContain('elif [[ "$RELEASE_OPERATION" == rollback ]]');
    expect(deploy).toContain('legacy deploy/rollback disabled');
    expect(deploy).not.toContain('yc lockbox');
    expect(
      step.indexOf('sudo -n /usr/local/sbin/digital-autograph-preflight'),
    ).toBeGreaterThan(-1);
    expect(
      step.indexOf('sudo -n /usr/local/sbin/digital-autograph-preflight'),
    ).toBeLessThan(step.indexOf('sudo -n install'));
    expect(step).toContain(
      'deploy/render-lockbox-env.mjs deploy/host-capacity.mjs',
    );
    expect(deploy).not.toContain('install -d');
  });
  it('uses the selected SHA for deploy checkout, with main configuration only for rollback', () => {
    expect(workflow).toContain(
      "ref: ${{ env.RELEASE_OPERATION == 'deploy' && env.IMAGE_SHA || github.sha }}",
    );
    expect(workflow.indexOf('Verify exact build checkout')).toBeLessThan(
      workflow.indexOf('Authenticate to Yandex Cloud'),
    );
    expect(workflow.indexOf('Verify exact deploy checkout')).toBeLessThan(
      workflow.indexOf('Deploy or roll back this VM'),
    );
    expect(workflow).toContain('--arg ref "$IMAGE_SHA"');
    const record = stepScript('Create GitHub deployment record');
    expect(record.indexOf('echo "id=$deployment_id"')).toBeLessThan(
      record.indexOf('statuses"'),
    );
    expect(workflow).toContain('export IMAGE_TAG=$IMAGE_SHA');
  });

  it('restricts staging to successful same-repository main push CI and keeps per-environment serialization', () => {
    expect(workflow).toContain("github.event.workflow_run.event == 'push'");
    expect(workflow).toContain(
      'github.event.workflow_run.head_repository.full_name == github.repository',
    );
    expect(workflow).toContain('--repo "$GITHUB_REPOSITORY"');
    expect(workflow).toContain(
      '.event == "push" and .headBranch == "main" and .headSha == env.IMAGE_SHA',
    );
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain("steps.deploy.outcome != 'success'");
  });

  it('isolates PostgreSQL in a persistent staging network without published ports or volume deletion', () => {
    const postgres = staging.split('\n  api:')[0];
    expect(postgres).toContain('POSTGRES_IMAGE:?');
    expect(postgres).toContain(
      'staging_postgres_data:/var/lib/postgresql/data',
    );
    expect(staging).toContain('name: digital-autograph-staging-postgres');
    expect(staging).toContain('internal: true');
    expect(postgres).not.toContain('ports:');
    expect(postgres).not.toContain('POSTGRES_PASSWORD:');
    expect(postgres).toContain('mem_limit: 384m');
    expect(production).not.toContain('image: postgres:');
    expect(production).toContain('postgres-ca.pem:ro');
    expect(deploy).not.toMatch(/\bdown\b/);
  });
});

it('requires immutable infrastructure IDs and keeps migrations profile-only', () => {
  expect(production).toContain('CADDY_IMAGE:?');
  expect(staging).toContain('POSTGRES_IMAGE:?');
  expect(production).toContain('pull_policy: never');
  expect(staging).toContain('pull_policy: never');
  expect(production).not.toContain('IMAGE_TAG');
  expect(production).toContain('profiles: [migration]');
});

it('keeps runner authorization restricted to fixed release entrypoints and exact install commands', () => {
  const policy = readFileSync(
    new URL('../../../deploy/runner.sudoers', import.meta.url),
    'utf8',
  );
  const entrypoint = readFileSync(
    new URL('../../../deploy/runner-preflight.sh', import.meta.url),
    'utf8',
  );
  expect(policy).toContain(
    '/usr/local/sbin/digital-autograph-preflight ^(deploy|rollback)$',
  );
  expect(policy).toContain(
    '/opt/digital-autograph/deploy-on-vm.sh ^([0-9a-f]{40}|rollback)$',
  );
  expect(policy).toContain(
    '/usr/bin/install -m 644 deploy/render-lockbox-env.mjs deploy/host-capacity.mjs /opt/digital-autograph/',
  );
  expect(policy).toContain('NOSETENV:');
  expect(policy).not.toMatch(/NOPASSWD: ALL|\/bin\/bash|\/usr\/bin\/node|\*/);
  expect(entrypoint).toContain('/usr/bin/env -i');
  expect(entrypoint).toContain(
    '/usr/bin/node /usr/local/lib/digital-autograph/host-capacity.mjs',
  );
  expect(entrypoint).not.toMatch(/eval|\$2/);
  expect(
    readFileSync(
      new URL('../../../.github/workflows/ci.yml', import.meta.url),
      'utf8',
    ),
  ).toContain('pnpm test:runner-authorization');
});
