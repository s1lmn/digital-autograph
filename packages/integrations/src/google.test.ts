import { describe, expect, it } from 'vitest';
import { createGoogleOidcClient } from './google';

describe('Google OIDC authorization request', () => {
  it('uses authorization code, exact callback, and identity-only scopes', () => {
    const client = createGoogleOidcClient({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      redirectUri: 'http://127.0.0.1:4000/auth/google/callback',
    });
    const url = new URL(
      client.authorizationUrl({ state: 'state-value', nonce: 'nonce-value' }),
    );
    expect(url.hostname).toBe('accounts.google.com');
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:4000/auth/google/callback',
    );
    expect(url.searchParams.get('response_type')?.toLowerCase()).toBe('code');
    expect(url.searchParams.get('scope')?.split(' ').sort()).toEqual([
      'email',
      'openid',
      'profile',
    ]);
    expect(url.searchParams.get('state')).toBe('state-value');
    expect(url.searchParams.get('nonce')).toBe('nonce-value');
    expect(url.searchParams.get('access_type')).toBe('online');
    expect(url.searchParams.has('prompt')).toBe(false);
  });
});
