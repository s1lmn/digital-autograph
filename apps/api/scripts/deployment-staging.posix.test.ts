import {
  realpathSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import {
  deploy,
  fingerprint,
  sha256,
  fileHash,
} from '../../../deploy/manual-deploy.mjs';
const toolFiles = [
  'manual-deploy.mjs',
  'manual-env.mjs',
  'deploy-on-vm.sh',
  'Caddyfile',
  'Caddyfile.destka',
  'postgres-bootstrap.sql',
  'postgres-runtime.sql',
  'database-state.sql',
  'compose.yaml',
  'compose.staging.yaml',
  'compose.manual.yaml',
];
const id = 'sha256:' + 'a'.repeat(64);
function fixture(failure = '') {
  const dir = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), 'destka-manual-')),
  );
  const root = path.join(dir, 'root'),
    state = path.join(dir, 'state');
  mkdirSync(root);
  mkdirSync(state);
  for (const f of toolFiles)
    copyFileSync(
      new URL('../../../deploy/' + f, import.meta.url),
      path.join(root, f),
    );
  const m = {
    schemaVersion: 1,
    caddyConfig: 'Caddyfile',
    sourceSha: 'a'.repeat(40),
    instanceId: 'a'.repeat(20),
    runtimeServiceAccountId: 'b'.repeat(20),
    runtimeSecretIds: ['c'.repeat(20), 'd'.repeat(20)],
    operation: 'synthetic-operation',
    database: 'synthetic_db',
    project: 'digital-autograph',
    environment: 'staging',
    images: Object.fromEntries(
      ['api', 'web', 'worker', 'migration'].map((app) => [
        app,
        { id, archive: app + '.tar', archiveSha256: sha256('archive') },
      ]),
    ),
    infrastructure: { postgres: id, caddy: id },
    domains: { web: 'web.invalid', api: 'api.invalid' },
    drainSeconds: 330,
    migrations: Array.from({ length: 24 }, (_, i) => ({
      hash: 'a'.repeat(64),
      created_at: i,
    })),
    metadataProofSha256: '',
    toolBundleSha256: '',
  };
  const incoming = path.join(root, 'incoming', m.operation);
  mkdirSync(path.join(incoming, 'env'), { recursive: true });
  for (const app of ['api', 'web', 'worker', 'migration'])
    writeFileSync(path.join(incoming, app + '.tar'), 'archive', {
      mode: 0o600,
    });
  for (const app of ['api', 'worker', 'migration'])
    writeFileSync(path.join(incoming, 'env', app + '.env'), 'private', {
      mode: 0o600,
    });
  const proof = JSON.stringify({
    instanceId: m.instanceId,
    observedAt: new Date().toISOString(),
    runtimeServiceAccountId: m.runtimeServiceAccountId,
    effectiveAuthorityReviewedBy: 'second-maintainer',
    lockbox: [
      { secretId: m.runtimeSecretIds[0], bindings: [] },
      { secretId: m.runtimeSecretIds[1], bindings: [] },
    ],
    metadata_options: {
      aws_v1_http_token: 'DISABLED',
      aws_v2_http_token: 'DISABLED',
      gce_http_token: 'DISABLED',
    },
  });
  writeFileSync(path.join(incoming, 'metadata-proof.json'), proof, {
    mode: 0o600,
  });
  m.metadataProofSha256 = sha256(proof);
  m.toolBundleSha256 = fingerprint(
    Object.fromEntries(
      toolFiles.map((f) => [f, sha256(readFileSync(path.join(root, f)))]),
    ),
  );
  const model = {
    services: {
      api: {
        environment: {
          DATABASE_URL:
            'postgresql://da_api:' + 'a'.repeat(40) + '@postgres/synthetic_db',
          S3_ACCESS_KEY_ID: 'synthetic',
          S3_SECRET_ACCESS_KEY: 'synthetic',
          S3_BUCKET: 'synthetic-bucket',
          S3_ENDPOINT: 'https://storage.example.invalid',
          DISABLE_NEW_PAYMENTS: 'true',
          DISABLE_FREE_CLAIMS: 'false',
        },
      },
      worker: {
        environment: {
          DATABASE_URL:
            'postgresql://da_worker:' +
            'b'.repeat(40) +
            '@postgres/synthetic_db',
          S3_ACCESS_KEY_ID: 'synthetic',
          S3_SECRET_ACCESS_KEY: 'synthetic',
          S3_BUCKET: 'synthetic-bucket',
          S3_ENDPOINT: 'https://storage.example.invalid',
        },
      },
      migration: {
        environment: {
          DATABASE_URL:
            'postgresql://da_migrator:' +
            'c'.repeat(40) +
            '@postgres/synthetic_db',
        },
      },
      postgres: {
        environment: {
          POSTGRES_USER: 'bootstrap',
          POSTGRES_DB: 'synthetic_db',
        },
      },
    },
  };
  const commands: string[] = [];
  let migrated = false;
  const baseline = {
    migrations: m.migrations.slice(0, 17),
    tables: { users: 1 },
  };
  const run = (
    program: string,
    args: string[],
    options?: { input?: string; stdoutFile?: string },
  ) => {
    const command = program + ' ' + args.join(' ');
    commands.push(command);
    if (program === 'df') return 'Avail\n20000000000\n';
    if (command.includes('image inspect'))
      return JSON.stringify([
        {
          Id: id,
          Os: 'linux',
          Architecture: 'amd64',
          Config: {
            Labels: { 'org.opencontainers.image.revision': m.sourceSha },
          },
        },
      ]);
    if (command.includes('config --format')) return JSON.stringify(model);
    if (command.includes('ps -q')) return args.at(-1)!;
    if (command.includes('ps -aq')) return 'api-container\nworker-container';
    if (command.includes('inspect --format')) {
      if (command.includes('.State.Status')) return id + ' running';
      return id;
    }
    if (command.includes('pg_dump')) {
      if (failure === 'dump') throw Error('synthetic');
      writeFileSync(options!.stdoutFile!, Buffer.from([0, 255, 128, 5]), {
        mode: 0o600,
      });
      return '';
    }
    if (command.includes('run --rm')) {
      if (failure === 'migration') throw Error('synthetic');
      migrated = true;
      return '';
    }
    if (options?.input?.includes('pg_hba_file_rules')) return '0';
    if (options?.input?.includes('pg_database_size')) return '10';
    if (options?.input?.includes('pg_stat_activity')) return '0';
    if (options?.input?.includes('json_build_object'))
      return JSON.stringify(
        migrated ? { ...baseline, migrations: m.migrations } : baseline,
      );
    if (command.includes('curl') && failure === 'health')
      throw Error('synthetic');
    if (command.includes('node --input-type'))
      return JSON.stringify({
        name: 'da_' + args[args.indexOf('-T') + 1],
        unsafe: false,
      });
    return '';
  };
  const options = {
    root,
    state,
    run,
    ownerUid: process.getuid!(),
    wait: () => {
      commands.push('drained');
    },
  };
  const recovery = () => {
    const op = path.join(state, m.operation),
      record = JSON.parse(readFileSync(path.join(op, 'state.json'), 'utf8'));
    writeFileSync(path.join(op, 'files-manifest.json'), 'files', {
      mode: 0o600,
    });
    writeFileSync(
      path.join(op, 'recovery-proof.json'),
      JSON.stringify({
        databaseArchiveSha256: fileHash(path.join(op, 'database.dump')),
        baselineHash: record.baselineHash,
        filesManifestSha256: sha256('files'),
        sourceBucket: 'synthetic-bucket',
        sourceEndpoint: 'https://storage.example.invalid',
        offVm: true,
        databaseRestorePassed: true,
        filesRestorePassed: true,
        reviewedBy: 'independent-maintainer',
      }),
      { mode: 0o600 },
    );
  };
  return {
    m,
    commands,
    options,
    dir,
    recovery,
    record: () =>
      JSON.parse(
        readFileSync(path.join(state, m.operation, 'state.json'), 'utf8'),
      ),
  };
}
it('stops old writers/restart policies before binary backup, requires off-VM recovery before migration, then starts verified immutable images', () => {
  const f = fixture();
  try {
    expect(deploy(f.m, 'prepare', f.options).stage).toBe('BACKUP_REQUIRED');
    expect(
      f.commands.findIndex((x) => x.includes('update --restart=no')),
    ).toBeLessThan(f.commands.findIndex((x) => x.includes('pg_dump')));
    expect(
      f.commands.findIndex((x) => x.includes('stop --timeout')),
    ).toBeLessThan(f.commands.indexOf('drained'));
    expect(f.commands.some((x) => x.includes('run --rm'))).toBe(false);
    expect(() => deploy(f.m, 'apply', f.options)).toThrow();
    expect(f.commands.some((x) => x.includes('run --rm'))).toBe(false);
    f.recovery();
    expect(deploy(f.m, 'apply', f.options).stage).toBe('MIGRATED');
    expect(deploy(f.m, 'start', f.options).stage).toBe('HEALTHY');
    expect(
      f.commands.some((x) =>
        /yc |lockbox|docker login| pull|prune|rollback/.test(x),
      ),
    ).toBe(false);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
it.each(['dump', 'migration', 'health'])(
  'stops safely on %s failure and never starts incompatible old images',
  (failure) => {
    const f = fixture(failure);
    try {
      if (failure === 'dump')
        expect(() => deploy(f.m, 'prepare', f.options)).toThrow();
      else {
        deploy(f.m, 'prepare', f.options);
        f.recovery();
        if (failure === 'migration')
          expect(() => deploy(f.m, 'apply', f.options)).toThrow();
        else {
          deploy(f.m, 'apply', f.options);
          expect(() => deploy(f.m, 'start', f.options)).toThrow();
        }
      }
      expect(f.record().stage).toBe('STOPPED');
      expect(
        f.commands.some(
          (x) => x.includes('old_image') || x.includes('pg_restore'),
        ),
      ).toBe(false);
      if (failure === 'migration')
        expect(f.commands.some((x) => x.includes('up -d'))).toBe(false);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  },
);
it('rejects partial migration replay and changed manifest before any migration', () => {
  const f = fixture('migration');
  try {
    deploy(f.m, 'prepare', f.options);
    f.recovery();
    expect(() => deploy(f.m, 'apply', f.options)).toThrow();
    const before = f.commands.filter((x) => x.includes('run --rm')).length;
    expect(() => deploy(f.m, 'apply', f.options)).toThrow('partial');
    expect(f.commands.filter((x) => x.includes('run --rm'))).toHaveLength(
      before,
    );
    expect(() =>
      deploy({ ...f.m, sourceSha: 'b'.repeat(40) }, 'start', f.options),
    ).toThrow('Manifest changed');
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
