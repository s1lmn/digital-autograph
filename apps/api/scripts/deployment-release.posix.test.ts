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
import { fileURLToPath } from 'node:url';
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
  const run = section?.split('        run: |\n')[1]?.split(/\n {0,9}\S/)[0];
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
if [[ "$1" == api ]]; then
  case "$2" in
    *compare*) echo "\${ANCESTRY:-ahead}" ;;
    *statuses*) echo "\${STAGING_STATE:-success}" ;;
    *deployments/42) echo "\${STAGING_SHA:-$IMAGE_SHA}" ;;
    --paginate) if [[ "\${STAGING_QUERY_FAIL:-false}" == true ]]; then exit 1; fi; echo 42 ;;
  esac
else echo "\${CI_SUCCESS:-true}"; fi
`;

describe('release SHA and authorization gates', () => {
  it.each(['false', 'true'])(
    'resolves single-platform release images without attestations (GITHUB_ACTIONS=%s)',
    (githubActions) => {
      const result = spawnSync(
        'docker',
        [
          'buildx',
          'bake',
          '--file',
          'deploy/docker-bake.hcl',
          '--print',
          '--push',
          'release',
        ],
        {
          cwd: fileURLToPath(new URL('../../../', import.meta.url)),
          env: {
            ...process.env,
            YC_REGISTRY_ID: 'test-registry',
            IMAGE_TAG: selected,
            GITHUB_ACTIONS: githubActions,
          },
          encoding: 'utf8',
          // A cold hosted runner exceeded the former 10-second CLI budget.
          // Keep a bounded deadline without retrying or weakening the contract.
          timeout: 30_000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status, result.stderr).toBe(0);
      const config = JSON.parse(result.stdout);
      const targets = ['api', 'web', 'worker', 'migration'];
      expect(config.group.release.targets).toEqual(targets);
      expect(Object.keys(config.target).sort()).toEqual([...targets].sort());
      for (const name of targets) {
        const target = config.target[name];
        expect(target.target).toBe(name);
        expect(target.platforms).toEqual(['linux/amd64']);
        expect(target.attest).toEqual([
          { type: 'provenance', disabled: true },
          { type: 'sbom', disabled: true },
        ]);
        expect(target.tags).toEqual([
          `cr.yandex/test-registry/digital-autograph/${name}:${selected}`,
        ]);
        expect(target.output).toEqual([
          { type: 'image', 'oci-mediatypes': 'false', push: 'true' },
        ]);
      }
    },
    35_000,
  );
  it.each(['deploy', 'rollback'])(
    'exports only the validated request for %s, ignoring rollback image input',
    (operation) => {
      const directory = mkdtempSync(path.join(os.tmpdir(), 'da-request-'));
      const output = path.join(directory, 'outputs');
      try {
        const result = runScript(
          stepScript('Export validated release request'),
          'unused',
          '#!/bin/bash\nexit 1\n',
          {
            ...requestEnv,
            RELEASE_OPERATION: operation,
            IMAGE_SHA:
              operation === 'rollback'
                ? '\noperation=deploy\ntarget=production'
                : selected,
            GITHUB_OUTPUT: output,
          },
        );
        expect(result.status, result.stderr).toBe(0);
        expect(readFileSync(output, 'utf8')).toBe(
          `target=staging\noperation=${operation}\nimage_sha=${operation === 'deploy' ? selected : ''}\n`,
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
  it.each([
    ['Verify exact build checkout', selected],
    ['Verify exact build checkout', current],
    ['Verify exact deploy checkout', selected],
    ['Verify exact deploy checkout', current],
  ])('checks %s against actual HEAD %s', (step, head) => {
    const result = runScript(
      stepScript(step),
      'git',
      '#!/bin/bash\necho "$CHECKOUT_HEAD"\n',
      { IMAGE_SHA: selected, CHECKOUT_HEAD: head },
    );
    expect(result.status).toBe(head === selected ? 0 : 1);
  });
  it.each([
    [{}, 0],
    [{ RELEASE_TARGET: 'other' }, 1],
    [{ RELEASE_OPERATION: 'rollback', IMAGE_SHA: '' }, 0],
    [
      {
        RELEASE_TARGET: 'production',
        PRODUCTION_OPERATOR: 'operator',
        PRODUCTION_APPROVAL: 'APPROVED',
      },
      0,
    ],
    [
      {
        RELEASE_TARGET: 'production',
        PRODUCTION_OPERATOR: 'operator',
        PRODUCTION_APPROVAL: 'APPROVED',
        STAGING_SHA: current,
      },
      1,
    ],
    [
      {
        RELEASE_TARGET: 'production',
        PRODUCTION_OPERATOR: 'operator',
        PRODUCTION_APPROVAL: 'APPROVED',
        STAGING_STATE: 'failure',
      },
      1,
    ],
    [
      {
        RELEASE_TARGET: 'production',
        PRODUCTION_OPERATOR: 'operator',
        PRODUCTION_APPROVAL: 'APPROVED',
        STAGING_QUERY_FAIL: 'true',
      },
      1,
    ],
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
elif [[ "$1" == buildx && "$2" == bake ]]; then printf '%s\\n' "$@" >>"$BUILD_LOG";
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
        if (builds)
          expect(readFileSync(log, 'utf8')).toBe(
            'buildx\nbake\n--file\ndeploy/docker-bake.hcl\n--push\napi\nweb\nworker\nmigration\n',
          );
        else expect(() => readFileSync(log)).toThrow();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

describe('retired release entrypoint', () => {
  it.each(['rollback', selected])(
    'refuses legacy %s before any command',
    (action) => {
      const result = spawnSync('bash', ['-c', deploy, 'deploy', action], {
        encoding: 'utf8',
      });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('legacy deploy/rollback disabled');
    },
  );
});
