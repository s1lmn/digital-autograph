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
        WEB_ORIGIN: 'http://127.0.0.1:3000',
        GOOGLE_CLIENT_ID: 'test-client',
        GOOGLE_CLIENT_SECRET: 'test-secret',
        GOOGLE_REDIRECT_URI: 'http://127.0.0.1:4000/auth/google/callback',
        TELEGRAM_CLIENT_ID: 'test-telegram-client',
        TELEGRAM_CLIENT_SECRET: 'test-telegram-secret',
        TELEGRAM_REDIRECT_URI: 'http://127.0.0.1:4000/auth/telegram/callback',
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
      WEB_ORIGIN: 'https://app.example.test',
      GOOGLE_CLIENT_ID: 'test-client',
      GOOGLE_CLIENT_SECRET: 'test-secret',
      GOOGLE_REDIRECT_URI: 'https://api.example.test/auth/google/callback',
      TELEGRAM_CLIENT_ID: 'test-telegram-client',
      TELEGRAM_CLIENT_SECRET: 'test-telegram-secret',
      TELEGRAM_REDIRECT_URI: 'https://api.example.test/auth/telegram/callback',
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

  it('requires a trusted web destination and exact HTTPS Google callback in production', () => {
    const base = {
      APP_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/app',
      API_HOST: '127.0.0.1',
      API_PORT: '4000',
      SESSION_TTL_SECONDS: '1209600',
      TRUSTED_WEB_ORIGINS: 'https://app.example.test',
      WEB_ORIGIN: 'https://app.example.test',
      GOOGLE_CLIENT_ID: 'test-client',
      GOOGLE_CLIENT_SECRET: 'test-secret',
      GOOGLE_REDIRECT_URI: 'https://api.example.test/auth/google/callback',
      TELEGRAM_CLIENT_ID: 'test-telegram-client',
      TELEGRAM_CLIENT_SECRET: 'test-telegram-secret',
      TELEGRAM_REDIRECT_URI: 'https://api.example.test/auth/telegram/callback',
    };
    expect(() =>
      loadApiConfig({ ...base, WEB_ORIGIN: 'https://other.example.test' }),
    ).toThrow(/WEB_ORIGIN/);
    expect(() =>
      loadApiConfig({
        ...base,
        GOOGLE_REDIRECT_URI: 'http://api.example.test/auth/google/callback',
      }),
    ).toThrow(/GOOGLE_REDIRECT_URI/);
    expect(() =>
      loadApiConfig({
        ...base,
        GOOGLE_REDIRECT_URI:
          'https://api.example.test/auth/google/callback?x=1',
      }),
    ).toThrow(/GOOGLE_REDIRECT_URI/);
    expect(() =>
      loadApiConfig({
        ...base,
        TELEGRAM_REDIRECT_URI: 'http://api.example.test/auth/telegram/callback',
      }),
    ).toThrow(/TELEGRAM_REDIRECT_URI/);
    expect(() =>
      loadApiConfig({
        ...base,
        TELEGRAM_REDIRECT_URI:
          'https://api.example.test/auth/telegram/callback?x=1',
      }),
    ).toThrow(/TELEGRAM_REDIRECT_URI/);
  });
});
