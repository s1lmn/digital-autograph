import { describe, expect, it } from 'vitest';
import { loadYandexAuthConfig } from './index';
const base = {
  APP_ENV: 'test',
  WEB_ORIGIN: 'http://127.0.0.1:3000',
  GOOGLE_REDIRECT_URI: 'http://127.0.0.1:4000/auth/google/callback',
  YANDEX_CLIENT_ID: 'synthetic-client',
  YANDEX_CLIENT_SECRET: 'synthetic-secret-marker',
  YANDEX_REDIRECT_URI: 'http://127.0.0.1:4000/auth/yandex/callback',
  YANDEX_AUTH_ENABLED: 'true',
  YANDEX_AUTH_APPROVED: 'true',
};
describe('Yandex opt-in configuration', () => {
  it('is disabled by default, without credentials, or without operator approval', () => {
    expect(loadYandexAuthConfig({})).toBeNull();
    expect(
      loadYandexAuthConfig({ ...base, YANDEX_AUTH_ENABLED: 'false' }),
    ).toBeNull();
    expect(
      loadYandexAuthConfig({ ...base, YANDEX_AUTH_APPROVED: undefined }),
    ).toBeNull();
    expect(loadYandexAuthConfig({ YANDEX_AUTH_ENABLED: 'true' })).toBeNull();
  });
  it('loads complete approved configuration only', () => {
    expect(loadYandexAuthConfig(base)).toEqual({
      clientId: base.YANDEX_CLIENT_ID,
      clientSecret: base.YANDEX_CLIENT_SECRET,
      redirectUri: base.YANDEX_REDIRECT_URI,
    });
  });
  it.each(['YANDEX_CLIENT_ID', 'YANDEX_CLIENT_SECRET', 'YANDEX_REDIRECT_URI'])(
    'fails closed if enabled without %s',
    (key) => {
      expect(() => loadYandexAuthConfig({ ...base, [key]: undefined })).toThrow(
        'values redacted',
      );
    },
  );
  it.each([
    'http://evil.example/auth/yandex/callback',
    'http://127.0.0.1:4001/auth/yandex/callback',
    'http://127.0.0.1:4000/auth/google/callback',
    'http://user:pass@127.0.0.1:4000/auth/yandex/callback',
    'http://127.0.0.1:4000/auth/yandex/callback?x=1',
    'http://127.0.0.1:4000/auth/yandex/callback#fragment',
  ])('rejects unsafe or wrong callback %s', (redirect) => {
    expect(() =>
      loadYandexAuthConfig({ ...base, YANDEX_REDIRECT_URI: redirect }),
    ).toThrow('values redacted');
  });
  it('requires HTTPS and the web/API host relationship in staging', () => {
    expect(() => loadYandexAuthConfig({ ...base, APP_ENV: 'staging' })).toThrow(
      'values redacted',
    );
    const config = {
      ...base,
      APP_ENV: 'staging',
      WEB_ORIGIN: 'https://staging.example.test',
      GOOGLE_REDIRECT_URI:
        'https://api.staging.example.test/auth/google/callback',
      YANDEX_REDIRECT_URI:
        'https://api.staging.example.test/auth/yandex/callback',
    };
    expect(loadYandexAuthConfig(config)?.redirectUri).toBe(
      config.YANDEX_REDIRECT_URI,
    );
    expect(() =>
      loadYandexAuthConfig({
        ...config,
        WEB_ORIGIN: 'https://other.example.test',
      }),
    ).toThrow('values redacted');
  });
  it('does not include malformed flag or secret values in error messages/causes', () => {
    try {
      loadYandexAuthConfig({
        ...base,
        YANDEX_AUTH_ENABLED: 'synthetic-secret-marker',
      });
    } catch (error) {
      expect(String(error)).not.toContain('synthetic-secret-marker');
      expect((error as Error).cause).toBeUndefined();
      return;
    }
    throw new Error('Expected error');
  });
});
