import { afterEach, describe, expect, it, vi } from 'vitest';
import { isolatedE2EEnvironment } from '../../../e2e/environment';

function localEnvironment() {
  for (const [key, value] of Object.entries({
    APP_ENV: 'test',
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://fixture:local_only@127.0.0.1:5434/autograph_e2e',
    S3_ENDPOINT: 'http://127.0.0.1:9002',
    S3_BUCKET: 'autographse2e',
    S3_ACCESS_KEY_ID: 'local_minio',
    S3_SECRET_ACCESS_KEY: 'local_only',
    E2E_WEB_URL: 'http://127.0.0.1:3000',
    API_PUBLIC_ORIGIN: 'http://127.0.0.1:4000',
    WEB_ORIGIN: 'http://127.0.0.1:3000',
  }))
    vi.stubEnv(key, value);
}
afterEach(() => vi.unstubAllEnvs());
describe('destructive E2E fixture safety boundary', () => {
  it.each(['9000', '9002'])(
    'permits the dedicated local CI/Compose storage port %s',
    (port) => {
      localEnvironment();
      vi.stubEnv('S3_ENDPOINT', `http://127.0.0.1:${port}`);
      expect(isolatedE2EEnvironment().databaseUrl).toContain('/autograph_e2e');
    },
  );
  it.each([
    ['APP_ENV', 'production'],
    ['APP_ENV', 'staging'],
    ['NODE_ENV', 'production'],
    ['DATABASE_URL', 'postgres://fixture:local_only@127.0.0.1:5434/autograph'],
    [
      'DATABASE_URL',
      'postgres://fixture:local_only@db.example.invalid:5434/autograph_e2e',
    ],
    [
      'DATABASE_URL',
      'postgres://fixture:local_only@127.0.0.1:5432/autograph_e2e',
    ],
    ['S3_ENDPOINT', 'https://storage.yandexcloud.net'],
    ['S3_BUCKET', 'autographs-local'],
    ['S3_ENDPOINT', 'http://127.0.0.1:9001'],
    ['E2E_WEB_URL', 'https://staging.destka.online'],
    ['API_PUBLIC_ORIGIN', 'https://api.staging.destka.online'],
  ])('rejects %s=%s before any database/storage mutation', (key, value) => {
    localEnvironment();
    vi.stubEnv(key, value);
    expect(() => isolatedE2EEnvironment()).toThrow();
  });
});
