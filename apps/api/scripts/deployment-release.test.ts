import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  new URL('../../../.github/workflows/release.yml', import.meta.url),
  'utf8',
);
const deploy = readFileSync(
  new URL('../../../deploy/deploy-on-vm.sh', import.meta.url),
  'utf8',
);
const selected = 'a'.repeat(40);
const current = 'b'.repeat(40);

function stepScript(name: string) {
  const section = workflow
    .split(`      - name: ${name}\n`)[1]
    ?.split('\n      - name:')[0];
  const run = section?.split('        run: |\n')[1]?.split('\n        env:')[0];
  if (!run) throw new Error(`Missing release step ${name}`);
  return run
    .split('\n')
    .map((line) => line.replace(/^ {10}/, ''))
    .join('\n');
}
function runScript(
  script: string,
  tool: string,
  source: string,
  env: Record<string, string>,
) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'da-release-'));
  try {
    const executable = path.join(dir, tool);
    writeFileSync(executable, source);
    chmodSync(executable, 0o755);
    return spawnSync('bash', ['-c', script], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, ...env },
      encoding: 'utf8',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const requestEnv = {
  GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REPOSITORY: 'owner/repo',
  GITHUB_ACTOR: 'operator',
  RELEASE_TARGET: 'staging',
  RELEASE_OPERATION: 'deploy',
  IMAGE_SHA: selected,
};
const gh = `#!/bin/bash
if [[ "$1" == api ]]; then echo "\${ANCESTRY:-ahead}"; else echo "\${CI_SUCCESS:-true}"; fi
`;

describe('release SHA and authorization gates', () => {
  it('uses the selected SHA for deploy checkout, with main configuration only for rollback', () => {
    expect(workflow).toContain(
      "ref: ${{ env.RELEASE_OPERATION == 'deploy' && env.IMAGE_SHA || github.sha }}",
    );
    expect(workflow.indexOf('Verify exact deploy checkout')).toBeLessThan(
      workflow.indexOf('Authenticate to Yandex Cloud'),
    );
    expect(workflow).toContain('--arg ref "$IMAGE_SHA"');
    const record = stepScript('Create GitHub deployment record');
    expect(record.indexOf('echo "id=$deployment_id"')).toBeLessThan(
      record.indexOf('statuses"'),
    );
    expect(workflow).toContain('export IMAGE_TAG=$IMAGE_SHA');
  });
  it.each([selected, current])(
    'checks actual HEAD %s before deployment',
    (head) => {
      const result = runScript(
        stepScript('Verify exact deploy checkout'),
        'git',
        '#!/bin/bash\necho "$CHECKOUT_HEAD"\n',
        { IMAGE_SHA: selected, CHECKOUT_HEAD: head },
      );
      expect(result.status).toBe(head === selected ? 0 : 1);
    },
  );
  it.each([
    [{}, 0],
    [{ IMAGE_SHA: 'main' }, 1],
    [{ GITHUB_REF: 'refs/heads/untrusted' }, 1],
    [{ ANCESTRY: 'diverged' }, 1],
    [{ CI_SUCCESS: 'false' }, 1],
    [
      {
        RELEASE_TARGET: 'production',
        PRODUCTION_OPERATOR: 'operator',
        PRODUCTION_APPROVAL: 'NO',
      },
      1,
    ],
    [
      {
        RELEASE_TARGET: 'production',
        PRODUCTION_OPERATOR: 'other',
        PRODUCTION_APPROVAL: 'APPROVED',
      },
      1,
    ],
  ] as const)('validates manual request %j', (changes, status) => {
    const result = runScript(stepScript('Validate release request'), 'gh', gh, {
      ...requestEnv,
      ...changes,
    });
    expect(result.status, result.stderr).toBe(status);
  });
  it.each([
    ['existing', 0, false],
    ['manifest unknown', 0, true],
    ['connection refused', 1, false],
  ] as const)(
    'fails closed on registry inspection %s',
    (inspection, status, builds) => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'da-image-log-'));
      const log = path.join(dir, 'builds');
      try {
        const docker = `#!/bin/bash
if [[ "$1" == login ]]; then cat >/dev/null;
elif [[ "$1" == buildx && "$2" == imagetools ]]; then
  if [[ "$INSPECTION" != existing ]]; then echo "$INSPECTION" >&2; exit 1; fi
elif [[ "$1" == buildx && "$2" == bake ]]; then echo build >>"$BUILD_LOG";
fi
`;
        const result = runScript(
          stepScript('Build and publish commit-tagged images once'),
          'docker',
          docker,
          {
            IMAGE_SHA: selected,
            YC_REGISTRY_ID: 'registry',
            YC_IAM_TOKEN: 'test-placeholder',
            INSPECTION: inspection,
            BUILD_LOG: log,
          },
        );
        expect(result.status, result.stderr).toBe(status);
        if (builds) expect(readFileSync(log, 'utf8')).toBe('build\n');
        else expect(() => readFileSync(log)).toThrow();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
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
});

describe('running deployment images', () => {
  it.each(['new', 'old'])(
    'rejects healthy containers still using %s image tags',
    (image) => {
      const fn = deploy
        .split('function application_images_match() {')[1]
        ?.split('\n}\n')[0];
      expect(fn).toBeTruthy();
      const docker = `#!/bin/bash
if [[ "$1" == compose ]]; then echo "\${!#}"; elif [[ "$3" == '{{.State.Status}}' ]]; then echo running; else echo "cr.yandex/registry/digital-autograph/\${!#}:$ACTUAL_TAG"; fi
`;
      const result = runScript(
        `function application_images_match() {${fn}\n}\napplication_images_match`,
        'docker',
        docker,
        {
          root: '/test',
          YC_REGISTRY_ID: 'registry',
          IMAGE_TAG: selected,
          ACTUAL_TAG: image === 'new' ? selected : current,
        },
      );
      expect(result.status, result.stderr).toBe(image === 'new' ? 0 : 1);
    },
  );
  it('does not accept old-container health after startup failure and keeps login through rollback', () => {
    expect(deploy).toContain('compose_updated=false');
    expect(deploy).toContain(
      'if [[ "$compose_updated" != true ]]; then break; fi',
    );
    expect(deploy).toContain(
      "trap 'docker logout cr.yandex >/dev/null 2>&1 || true' EXIT",
    );
    expect(deploy).not.toContain('\ndocker logout cr.yandex');
    expect(deploy).toContain('if [[ "$rollback" == false ]]; then');
  });
});
