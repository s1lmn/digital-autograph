import console from 'node:console';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileHash, fingerprint } from '../deploy/manual-deploy.mjs';
const run = (cmd, args, extra = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...extra });
  if (r.status !== 0 || r.error) throw Error('Local bundle command failed');
  return r.stdout;
};
try {
  const [sourceSha, output, siteFile] = process.argv.slice(2);
  if (
    !/^[a-f0-9]{40}$/.test(sourceSha) ||
    !output ||
    !siteFile ||
    path.resolve(output).startsWith(process.cwd() + path.sep)
  )
    throw Error(
      'Reviewed SHA and external private output/site config required',
    );
  if (
    run('git', ['rev-parse', 'HEAD']).trim() !== sourceSha ||
    run('git', ['status', '--porcelain']).trim()
  )
    throw Error('Clean exact reviewed checkout required');
  const site = JSON.parse(readFileSync(siteFile, 'utf8'));
  if (
    !/^[a-z0-9]{20}$/.test(site.instanceId) ||
    !/^[a-z0-9]{20}$/.test(site.runtimeServiceAccountId) ||
    !/^sha256:[a-f0-9]{64}$/.test(site.infrastructure?.postgres) ||
    !/^sha256:[a-f0-9]{64}$/.test(site.infrastructure?.caddy)
  )
    throw Error('Read-only inventory required before build');
  mkdirSync(output, { mode: 0o700 });
  run(
    'docker',
    ['buildx', 'bake', '--file', 'deploy/docker-bake.hcl', '--load', 'release'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        IMAGE_TAG: sourceSha,
        GITHUB_ACTIONS: 'false',
        YC_REGISTRY_ID: 'offline',
      },
    },
  );
  const images = {};
  for (const app of ['api', 'web', 'worker', 'migration']) {
    const ref = `cr.yandex/offline/digital-autograph/${app}:${sourceSha}`;
    const id = run('docker', [
      'image',
      'inspect',
      '--format',
      '{{.Id}}',
      ref,
    ]).trim();
    const archive = app + '.tar';
    run('docker', ['save', '--output', path.join(output, archive), id], {
      stdio: 'inherit',
    });
    chmodSync(path.join(output, archive), 0o600);
    images[app] = {
      id,
      archive,
      archiveSha256: fileHash(path.join(output, archive)),
    };
  }
  const journal = JSON.parse(
    readFileSync('packages/db/drizzle/meta/_journal.json', 'utf8'),
  );
  const toolFiles = [
    'manual-deploy.mjs',
    'manual-env.mjs',
    'deploy-on-vm.sh',
    'Caddyfile',
    'Caddyfile.destka',
    'postgres-bootstrap.sql',
    'postgres-preflight.sql',
    'postgres-normalize.sql',
    'postgres-runtime.sql',
    'database-state.sql',
    'compose.yaml',
    'compose.staging.yaml',
    'compose.manual.yaml',
  ];
  const manifest = {
    schemaVersion: 1,
    sourceSha,
    operation: site.operation,
    instanceId: site.instanceId,
    runtimeServiceAccountId: site.runtimeServiceAccountId,
    runtimeSecretIds: site.runtimeSecretIds,
    environment: 'staging',
    project: 'digital-autograph',
    database: site.database,
    domains: site.domains,
    caddyConfig: site.caddyConfig ?? 'Caddyfile',
    publicDomainApproved: site.publicDomainApproved === true,
    infrastructure: site.infrastructure,
    drainSeconds: site.drainSeconds,
    images,
    migrations: journal.entries.map((e) => ({
      hash: fileHash(`packages/db/drizzle/${e.tag}.sql`),
      created_at: e.when,
    })),
    toolBundleSha256: fingerprint(
      Object.fromEntries(
        toolFiles.map((f) => [f, fileHash(path.join('deploy', f))]),
      ),
    ),
  };
  writeFileSync(
    path.join(output, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    { mode: 0o600, flag: 'wx' },
  );
  console.log(
    'Offline bundle built; capture fresh authority proof after backup/restore and the separately approved VM option change. No image was published.',
  );
} catch {
  console.error(
    'Offline release preparation stopped. No server/cloud mutation or image publication.',
  );
  process.exitCode = 1;
}
