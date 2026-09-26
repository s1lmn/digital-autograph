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
        SESSION_TTL_SECONDS: '1209600',
        TRUSTED_WEB_ORIGINS: 'http://127.0.0.1:3000',
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

  it('rejects wildcard or path-bearing credentialed origins and invalid session TTL', () => {
    const base = {
      APP_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/app',
      API_HOST: '127.0.0.1',
      API_PORT: '4000',
      SESSION_TTL_SECONDS: '1209600',
      TRUSTED_WEB_ORIGINS: 'https://app.example.test',
    };
    expect(() => loadApiConfig({ ...base, TRUSTED_WEB_ORIGINS: '*' })).toThrow(
      /TRUSTED_WEB_ORIGINS/,
    );
    expect(() =>
      loadApiConfig({
        ...base,
        TRUSTED_WEB_ORIGINS: 'https://app.example.test/path',
      }),
    ).toThrow(/TRUSTED_WEB_ORIGINS/);
    expect(() => loadApiConfig({ ...base, SESSION_TTL_SECONDS: '60' })).toThrow(
      /SESSION_TTL_SECONDS/,
    );
    expect(() =>
      loadApiConfig({
        ...base,
        TRUSTED_WEB_ORIGINS: 'http://app.example.test',
      }),
    ).toThrow(/TRUSTED_WEB_ORIGINS/);
  });
});
