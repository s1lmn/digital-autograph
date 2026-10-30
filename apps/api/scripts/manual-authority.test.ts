import { expect, it } from 'vitest';
import {
  validateMetadataProof,
  validateManifest,
  validateRuntime,
} from '../../../deploy/manual-deploy.mjs';
const instance = 'a'.repeat(20),
  sa = 'b'.repeat(20),
  secrets = ['c'.repeat(20), 'd'.repeat(20)];
function proof() {
  return {
    instanceId: instance,
    runtimeServiceAccountId: sa,
    effectiveAuthorityReviewedBy: 'other-maintainer',
    observedAt: new Date().toISOString(),
    metadata_options: {
      aws_v1_http_token: 'DISABLED',
      aws_v2_http_token: 'DISABLED',
      gce_http_token: 'DISABLED',
    },
    lockbox: secrets.map((secretId) => ({
      secretId,
      bindings: [] as { subject: { id: string } }[],
    })),
  };
}
it('requires every metadata credential dialect disabled, exact secret IDs, removed runtime/public grants and recent evidence', () => {
  expect(() =>
    validateMetadataProof(proof(), instance, sa, secrets),
  ).not.toThrow();
  for (const key of [
    'aws_v1_http_token',
    'aws_v2_http_token',
    'gce_http_token',
  ] as const) {
    const p = proof();
    p.metadata_options[key] = 'ENABLED';
    expect(() => validateMetadataProof(p, instance, sa, secrets)).toThrow();
  }
  for (const id of [sa, 'allUsers', 'allAuthenticatedUsers']) {
    const p = proof();
    p.lockbox[0]!.bindings.push({ subject: { id } });
    expect(() => validateMetadataProof(p, instance, sa, secrets)).toThrow();
  }
  for (const date of [
    'invalid',
    new Date(Date.now() - 25 * 3600000).toISOString(),
  ]) {
    const p = proof();
    p.observedAt = date;
    expect(() => validateMetadataProof(p, instance, sa, secrets)).toThrow();
  }
  expect(() =>
    validateMetadataProof(proof(), instance, sa, [
      'e'.repeat(20),
      'f'.repeat(20),
    ]),
  ).toThrow();
});
it('refuses mutable artifacts, missing receipts and public domain changes without explicit approval', () => {
  const m = {
    schemaVersion: 1,
    sourceSha: 'a'.repeat(40),
    operation: 'manual-test',
    instanceId: instance,
    runtimeServiceAccountId: sa,
    runtimeSecretIds: secrets,
    database: 'synthetic',
    project: 'digital-autograph',
    environment: 'staging',
    images: Object.fromEntries(
      ['api', 'web', 'worker', 'migration'].map((app) => [
        app,
        {
          id: 'sha256:' + 'a'.repeat(64),
          archive: app + '.tar',
          archiveSha256: 'a'.repeat(64),
        },
      ]),
    ),
    infrastructure: {
      postgres: 'sha256:' + 'a'.repeat(64),
      caddy: 'sha256:' + 'b'.repeat(64),
    },
    domains: { web: 'web.invalid', api: 'api.invalid' },
    toolBundleSha256: 'b'.repeat(64),
    migrations: Array.from({ length: 24 }, (_, i) => ({
      created_at: i,
      hash: 'a'.repeat(64),
    })),
    drainSeconds: 330,
    caddyConfig: 'Caddyfile',
  };
  expect(() => validateManifest(m)).not.toThrow();
  for (const change of [
    (x: typeof m) => {
      x.images.api!.id = 'latest';
    },
    (x: typeof m) => {
      x.images.worker!.archive = '../worker.tar';
    },
    (x: typeof m) => {
      x.migrations.pop();
    },
    (x: typeof m) => {
      x.drainSeconds = 0;
    },
    (x: typeof m) => {
      x.caddyConfig = 'Caddyfile.destka';
      x.domains = { web: 'destka.ru', api: 'api.destka.ru' };
    },
  ]) {
    const x = structuredClone(m);
    change(x);
    expect(() => validateManifest(x)).toThrow();
  }
});
it('refuses shared credentials, DSN escape, admin bootstrap reuse, paid operations and missing explicit storage credentials', () => {
  const env = (role: string, password: string) => ({
    DATABASE_URL: `postgresql://da_${role}:${password.repeat(40)}@postgres/synthetic`,
    S3_ACCESS_KEY_ID: 'local',
    S3_SECRET_ACCESS_KEY: 'synthetic',
    DISABLE_NEW_PAYMENTS: 'true',
    DISABLE_FREE_CLAIMS: 'false',
  });
  const m = { database: 'synthetic' },
    model = {
      services: {
        api: { environment: env('api', 'a') },
        worker: { environment: env('worker', 'b') },
        migration: { environment: env('migrator', 'c') },
        postgres: {
          environment: {
            POSTGRES_USER: 'operator',
            POSTGRES_DB: 'synthetic',
            POSTGRES_PASSWORD: 'private-bootstrap',
          },
        },
      },
    };
  expect(() => validateRuntime(model, m)).not.toThrow();
  for (const change of [
    (x: typeof model) => {
      x.services.api.environment.DATABASE_URL += '?host=external.invalid';
    },
    (x: typeof model) => {
      x.services.api.environment.DISABLE_NEW_PAYMENTS = 'false';
    },
    (x: typeof model) => {
      x.services.worker.environment.S3_SECRET_ACCESS_KEY = '';
    },
    (x: typeof model) => {
      x.services.postgres.environment.POSTGRES_PASSWORD = 'a'.repeat(40);
    },
    (x: typeof model) => {
      x.services.migration.environment.DATABASE_URL =
        x.services.api.environment.DATABASE_URL;
    },
  ]) {
    const x = structuredClone(model);
    change(x);
    expect(() => validateRuntime(x, m)).toThrow();
  }
});
