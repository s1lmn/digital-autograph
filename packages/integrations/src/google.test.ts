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
      'openid',
    ]);
    expect(url.searchParams.get('state')).toBe('state-value');
    expect(url.searchParams.get('nonce')).toBe('nonce-value');
    expect(url.searchParams.get('access_type')).toBe('online');
    expect(url.searchParams.has('prompt')).toBe(false);
  });
});

it('verifies a minimal Google assertion without email/name/avatar and persists no extra claims', async () => {
  const { OAuth2Client, LoginTicket } = await import('google-auth-library');
  const { vi } = await import('vitest');
  const prototype = OAuth2Client.prototype as unknown as {
    getToken(
      input: unknown,
    ): Promise<{ tokens: { id_token: string }; res: null }>;
    verifyIdToken(input: unknown): Promise<InstanceType<typeof LoginTicket>>;
  };
  const token = vi.spyOn(prototype, 'getToken').mockResolvedValue({
    tokens: { id_token: 'synthetic-id-token' },
    res: null,
  });
  const verify = vi.spyOn(prototype, 'verifyIdToken').mockResolvedValue(
    new LoginTicket('synthetic-envelope', {
      iss: 'https://accounts.google.com',
      aud: 'test-client-id',
      sub: 'verified-sub',
      nonce: 'verified-nonce',
      iat: 1,
      exp: 2,
    }),
  );
  try {
    const client = createGoogleOidcClient({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      redirectUri: 'http://127.0.0.1:4000/auth/google/callback',
    });
    expect(await client.verifyCode('synthetic-code')).toEqual({
      subject: 'verified-sub',
      nonce: 'verified-nonce',
    });
    expect(token).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith({
      idToken: 'synthetic-id-token',
      audience: 'test-client-id',
    });
  } finally {
    vi.restoreAllMocks();
  }
});
