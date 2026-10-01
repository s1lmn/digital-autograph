import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const deploy = readFileSync(
  new URL('../../../deploy/deploy-on-vm.sh', import.meta.url),
  'utf8',
);
const staging = readFileSync(
  new URL('../../../deploy/compose.staging.yaml', import.meta.url),
  'utf8',
);
const production = readFileSync(
  new URL('../../../deploy/compose.yaml', import.meta.url),
  'utf8',
);
const selected = 'a'.repeat(40);
const current = 'b'.repeat(40);

function release(environment: string, operation = selected, failure = '') {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'da-staging-release-'));
  try {
    const root = path.join(dir, 'release');
    const state = path.join(dir, 'state');
    const config = path.join(dir, 'deploy.conf');
    const log = path.join(dir, 'commands');
    for (const item of [root, state, path.join(state, 'staging-backups')])
      mkdirSync(item, { recursive: true });
    writeFileSync(
      config,
      `APP_ENV=${environment}\nYC_REGISTRY_ID=registry\nYC_LOCKBOX_API_SECRET_ID=api\nYC_LOCKBOX_WORKER_SECRET_ID=worker\nWEB_DOMAIN=web.invalid\nAPI_DOMAIN=api.invalid\n`,
    );
    writeFileSync(path.join(state, 'current-image-tag'), current);
    writeFileSync(path.join(state, 'previous-image-tag'), selected);
    for (let i = 1; i <= 3; i++)
      writeFileSync(
        path.join(state, `staging-backups/2020010${i}.dump`),
        'old backup',
      );
    const tools: Record<string, string> = {
      yc: '#!/bin/bash\necho synthetic-test-payload\n',
      node: '#!/bin/bash\ncat >/dev/null\n',
      curl: '#!/bin/bash\nexit 0\n',
      docker: `#!/bin/bash
printf '%s\\n' "$*" >>"$COMMAND_LOG"
if [[ "$1" == login ]]; then cat >/dev/null
elif [[ "$1" == compose ]]; then
  case "$*" in
    *"--profile migration pull"*) if [[ "$FAILURE" == pull ]]; then exit 1; fi ;;
    *"exec -T postgres"*) if [[ "$FAILURE" == backup ]]; then exit 1; fi; echo dump ;;
    *"run --rm migration"*) if [[ "$FAILURE" == migration ]]; then exit 1; fi ;;
    *"up -d --remove-orphans"*) if [[ "$FAILURE" == startup && ! -f "$COMMAND_LOG.failed" ]]; then touch "$COMMAND_LOG.failed"; exit 1; fi ;;
    *"ps -q"*) echo "\${!#}" ;;
  esac
elif [[ "$1" == inspect ]]; then
  if [[ "$3" == '{{.State.Status}}' ]]; then echo running;
  else echo "cr.yandex/registry/digital-autograph/\${!#}:$IMAGE_TAG"; fi
fi
`,
    };
    for (const [name, content] of Object.entries(tools)) {
      writeFileSync(path.join(dir, name), content);
      chmodSync(path.join(dir, name), 0o755);
    }
    const script = deploy
      .replace('root=/opt/digital-autograph', `root=${root}`)
      .replace('config=/etc/digital-autograph/deploy.conf', `config=${config}`)
      .replace('state=/var/lib/digital-autograph', `state=${state}`)
      .replaceAll('/etc/digital-autograph/env', path.join(dir, 'env'));
    const result = spawnSync('bash', ['-c', script, 'release', operation], {
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        COMMAND_LOG: log,
        FAILURE: failure,
      },
      encoding: 'utf8',
    });
    const backups = readdirSync(path.join(state, 'staging-backups'));
    return {
      result,
      commands: readFileSync(log, 'utf8').split('\n').filter(Boolean),
      active: readFileSync(
        path.join(state, 'current-image-tag'),
        'utf8',
      ).trim(),
      backups,
      modes: backups.map(
        (name) =>
          statSync(path.join(state, 'staging-backups', name)).mode & 0o777,
      ),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('staging release context and persistence', () => {
  it.each(['staging', 'production'])(
    'uses the same %s compose context for every command',
    (environment) => {
      const run = release(environment);
      expect(run.result.status, run.result.stderr).toBe(0);
      const commands = run.commands.filter((line) =>
        line.startsWith('compose '),
      );
      expect(commands.some((line) => line.includes('run --rm migration'))).toBe(
        true,
      );
      expect(commands.some((line) => line.includes('ps -q'))).toBe(true);
      expect(
        commands.every(
          (line) =>
            line.includes('compose.staging.yaml') ===
            (environment === 'staging'),
        ),
      ).toBe(true);
      if (environment === 'production')
        expect(commands.some((line) => line.includes('postgres'))).toBe(false);
    },
  );
  it.each(['staging', 'production'])(
    'requires all published images before %s migration without building',
    (environment) => {
      const run = release(environment, selected, 'pull');
      expect(run.result.status).toBe(1);
      expect(
        run.commands.some((line) => line.includes('--profile migration pull')),
      ).toBe(true);
      expect(
        run.commands.some((line) =>
          /build|push|run --rm migration|up -d/.test(line),
        ),
      ).toBe(false);
      expect(run.active).toBe(current);
    },
  );
  it('backs up the available staging DB before migration and retains three owner-only dumps', () => {
    const run = release('staging');
    const backup = run.commands.findIndex((line) =>
      line.includes('exec -T postgres'),
    );
    const migration = run.commands.findIndex((line) =>
      line.includes('run --rm migration'),
    );
    const replacement = run.commands.findIndex((line) =>
      line.includes('up -d --remove-orphans'),
    );
    expect(backup).toBeGreaterThan(-1);
    expect(backup).toBeLessThan(migration);
    expect(migration).toBeLessThan(replacement);
    expect(run.backups).toHaveLength(3);
    expect(run.backups).not.toContain('20200101.dump');
    expect(run.modes).toContain(0o600);
  });
  it.each(['backup', 'migration'])(
    'keeps the current application and backup when %s fails',
    (failure) => {
      const run = release('staging', selected, failure);
      expect(run.result.status).toBe(1);
      expect(run.active).toBe(current);
      expect(
        run.commands.some((line) => line.includes('up -d --remove-orphans')),
      ).toBe(false);
      expect(run.backups.some((name) => name.endsWith('.tmp'))).toBe(false);
      if (failure === 'migration')
        expect(run.backups.some((name) => !name.startsWith('2020'))).toBe(true);
      else
        expect(
          run.commands.some((line) => line.includes('run --rm migration')),
        ).toBe(false);
    },
  );
  it('uses the staging context for rollback without migration or DB restore', () => {
    const run = release('staging', 'rollback');
    expect(run.result.status, run.result.stderr).toBe(0);
    expect(
      run.commands
        .filter((line) => line.startsWith('compose '))
        .every((line) => line.includes('compose.staging.yaml')),
    ).toBe(true);
    expect(
      run.commands.some((line) => /migration|pg_dump|pg_restore/.test(line)),
    ).toBe(false);
    expect(run.active).toBe(selected);
  });
  it('uses the staging context during automatic application rollback without restoring the database', () => {
    const run = release('staging', selected, 'startup');
    expect(run.result.status, run.result.stderr).toBe(1);
    expect(run.result.stderr).toContain('Previous application image restored');
    expect(run.active).toBe(current);
    expect(
      run.commands.filter((line) => line.includes('run --rm migration')),
    ).toHaveLength(1);
    expect(
      run.commands
        .filter((line) => line.startsWith('compose '))
        .every((line) => line.includes('compose.staging.yaml')),
    ).toBe(true);
    expect(run.commands.some((line) => /pg_restore|down/.test(line))).toBe(
      false,
    );
  });
  it('isolates PostgreSQL in a persistent staging network without published ports or volume deletion', () => {
    const postgres = staging.split('\n  api:')[0];
    expect(postgres).toContain('image: postgres:17-alpine');
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
