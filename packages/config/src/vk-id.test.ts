import { describe, expect, it } from 'vitest';
import { loadVkIdAuthConfig } from './index';
const base = {
  APP_ENV: 'test',
  WEB_ORIGIN: 'http://127.0.0.1:3000',
  GOOGLE_REDIRECT_URI: 'http://127.0.0.1:4000/auth/google/callback',
  VK_CLIENT_ID: '123456',
  VK_SERVICE_TOKEN: 'synthetic-secret-marker',
  VK_REDIRECT_URI: 'http://127.0.0.1:4000/auth/vk-id/callback',
  VK_AUTH_ENABLED: 'true',
  VK_AUTH_APPROVED: 'true',
};
describe('VkId opt-in configuration', () => {
  it('is disabled by default, without credentials, or without operator approval', () => {
    expect(loadVkIdAuthConfig({})).toBeNull();
    expect(
      loadVkIdAuthConfig({ ...base, VK_AUTH_ENABLED: 'false' }),
    ).toBeNull();
    expect(
      loadVkIdAuthConfig({ ...base, VK_AUTH_APPROVED: undefined }),
    ).toBeNull();
    expect(loadVkIdAuthConfig({ VK_AUTH_ENABLED: 'true' })).toBeNull();
  });
  it('loads complete approved configuration only', () => {
    expect(loadVkIdAuthConfig(base)).toEqual({
      clientId: base.VK_CLIENT_ID,
      serviceToken: base.VK_SERVICE_TOKEN,
      redirectUri: base.VK_REDIRECT_URI,
    });
  });
  it.each(['VK_CLIENT_ID', 'VK_SERVICE_TOKEN', 'VK_REDIRECT_URI'])(
    'fails closed if enabled without %s',
    (key) => {
      expect(() => loadVkIdAuthConfig({ ...base, [key]: undefined })).toThrow(
        'values redacted',
      );
    },
  );
  it.each([
    'http://evil.example/auth/vk-id/callback',
    'http://127.0.0.1:4001/auth/vk-id/callback',
    'http://127.0.0.1:4000/auth/google/callback',
    'http://user:pass@127.0.0.1:4000/auth/vk-id/callback',
    'http://127.0.0.1:4000/auth/vk-id/callback?x=1',
    'http://127.0.0.1:4000/auth/vk-id/callback#fragment',
  ])('rejects unsafe or wrong callback %s', (redirect) => {
    expect(() =>
      loadVkIdAuthConfig({ ...base, VK_REDIRECT_URI: redirect }),
    ).toThrow('values redacted');
  });
  it('requires HTTPS and the web/API host relationship in staging', () => {
    expect(() => loadVkIdAuthConfig({ ...base, APP_ENV: 'staging' })).toThrow(
      'values redacted',
    );
    const config = {
      ...base,
      APP_ENV: 'staging',
      WEB_ORIGIN: 'https://staging.example.test',
      GOOGLE_REDIRECT_URI:
        'https://api.staging.example.test/auth/google/callback',
      VK_REDIRECT_URI: 'https://api.staging.example.test/auth/vk-id/callback',
    };
    expect(loadVkIdAuthConfig(config)?.redirectUri).toBe(
      config.VK_REDIRECT_URI,
    );
    expect(() =>
      loadVkIdAuthConfig({
        ...config,
        WEB_ORIGIN: 'https://other.example.test',
      }),
    ).toThrow('values redacted');
  });
  it('does not include malformed flag or secret values in error messages/causes', () => {
    try {
      loadVkIdAuthConfig({
        ...base,
        VK_AUTH_ENABLED: 'synthetic-secret-marker',
      });
    } catch (error) {
      expect(String(error)).not.toContain('synthetic-secret-marker');
      expect((error as Error).cause).toBeUndefined();
      return;
    }
    throw new Error('Expected error');
  });
});
