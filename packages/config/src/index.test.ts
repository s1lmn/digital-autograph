import { describe, expect, it } from 'vitest';
import { loadApiConfig, loadDatabaseConfig, loadWebConfig } from './index';

describe('typed configuration', () => {
  it('accepts a valid API environment and coerces the port', () => {
    expect(
      loadApiConfig({
        APP_ENV: 'local',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/app',
        API_HOST: '127.0.0.1',
        API_PORT: '4000',
      }),
    ).toMatchObject({ API_PORT: 4000, APP_ENV: 'local' });
  });

  it('reports missing required settings without printing secret values', () => {
    expect(() => loadDatabaseConfig({ APP_ENV: 'test' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects an invalid application environment', () => {
    expect(() =>
      loadWebConfig({
        APP_ENV: 'preview',
        API_INTERNAL_URL: 'http://api:4000',
      }),
    ).toThrow(/APP_ENV/);
  });
});
