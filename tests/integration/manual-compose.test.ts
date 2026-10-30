import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { expect, it } from 'vitest';
import { validateRuntime } from '../../deploy/manual-deploy.mjs';
it('resolves the real Compose overlay with separate DSNs/pinned IDs and retains incident freezes; legacy env cannot start it', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'destka-compose-')),
    runtime = path.join(dir, 'runtime'),
    bootstrap = path.join(dir, 'bootstrap');
  mkdirSync(runtime);
  mkdirSync(bootstrap);
  try {
    for (const file of [
      'compose.yaml',
      'compose.staging.yaml',
      'compose.manual.yaml',
    ])
      writeFileSync(
        path.join(dir, file),
        readFileSync('deploy/' + file, 'utf8').replaceAll(
          '/etc/digital-autograph/env',
          bootstrap,
        ),
      );
    writeFileSync(
      path.join(bootstrap, 'postgres.env'),
      'POSTGRES_DB=synthetic\nPOSTGRES_USER=operator\nPOSTGRES_PASSWORD=synthetic-bootstrap\n',
    );
    for (const app of ['api', 'worker', 'migration'])
      writeFileSync(
        path.join(runtime, app + '.env'),
        `DATABASE_URL=postgresql://da_${app === 'migration' ? 'migrator' : app}:${app.repeat(40)}@postgres/synthetic\nS3_ACCESS_KEY_ID=synthetic\nS3_SECRET_ACCESS_KEY=synthetic\nDISABLE_FREE_CLAIMS=false\n`,
      );
    const envFile = path.join(dir, 'compose.env');
    writeFileSync(
      envFile,
      [
        'APP_ENV=staging',
        'WEB_DOMAIN=web.invalid',
        'API_DOMAIN=api.invalid',
        ...['API', 'WEB', 'WORKER', 'MIGRATION', 'POSTGRES', 'CADDY'].map(
          (app) => `${app}_IMAGE=sha256:${'a'.repeat(64)}`,
        ),
        `RUNTIME_ENV_DIR=${runtime}`,
        `CADDY_CONFIG=${path.resolve('deploy/Caddyfile')}`,
      ].join('\n') + '\n',
    );
    const args = [
      'compose',
      '--project-name',
      'destka-manual-config-test',
      '--profile',
      'migration',
      '--env-file',
      envFile,
      '-f',
      path.join(dir, 'compose.yaml'),
      '-f',
      path.join(dir, 'compose.staging.yaml'),
      '-f',
      path.join(dir, 'compose.manual.yaml'),
      'config',
      '--format',
      'json',
    ];
    const model = () => {
      const r = spawnSync('docker', args, { encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      return JSON.parse(r.stdout);
    };
    const good = model();
    expect(() =>
      validateRuntime(good, { database: 'synthetic' }),
    ).not.toThrow();
    expect(good.services.migration.environment.DATABASE_URL).toContain(
      'da_migrator:',
    );
    expect(good.services.api.environment.DISABLE_NEW_PAYMENTS).toBe('true');
    expect(good.services.postgres.environment.POSTGRES_USER).toBe('operator');
    writeFileSync(
      path.join(bootstrap, 'incident.env'),
      'DISABLE_FREE_CLAIMS=true\n',
    );
    expect(() => validateRuntime(model(), { database: 'synthetic' })).toThrow();
    writeFileSync(
      envFile,
      'APP_ENV=staging\nYC_REGISTRY_ID=old\nIMAGE_TAG=old\nWEB_DOMAIN=web.invalid\nAPI_DOMAIN=api.invalid\n',
    );
    expect(spawnSync('docker', args, { encoding: 'utf8' }).status).not.toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 15000);
