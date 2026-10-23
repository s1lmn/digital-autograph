import { generateKeyPairSync, sign } from 'node:crypto';
import type { CustomFetch } from 'openid-client';
import { describe, expect, it } from 'vitest';
import { createTelegramOidcClient } from './telegram';

const issuer = 'https://oauth.telegram.org';
const clientId = '123456789';
const redirectUri = 'http://127.0.0.1:4000/auth/telegram/callback';
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'test-key',
  use: 'sig',
  alg: 'RS256',
};

type TokenClaims = {
  iss?: string;
  aud?: string;
  exp?: number;
  nonce?: string;
};

function signedIdToken(overrides: TokenClaims = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test-key' }),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: issuer,
      aud: clientId,
      sub: 'telegram-sub',
      iat: now,
      exp: now + 3600,
      nonce: 'test-nonce',
      ...overrides,
    }),
  ).toString('base64url');
  const body = `${header}.${payload}`;
  const signature = sign('RSA-SHA256', Buffer.from(body), privateKey).toString(
    'base64url',
  );
  return `${body}.${signature}`;
}

function fakeFetch(
  token: () => string,
  exchanges: URLSearchParams[],
): CustomFetch {
  return async (url, options) => {
    if (url === `${issuer}/.well-known/openid-configuration`) {
      return Response.json({
        issuer,
        authorization_endpoint: `${issuer}/auth`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/.well-known/jwks.json`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
      });
    }
    if (url === `${issuer}/token`) {
      const authorization =
        options.headers.authorization ?? options.headers.Authorization;
      expect(authorization).toBe(
        `Basic ${Buffer.from(`${clientId}:testsecret`).toString('base64')}`,
      );
      const body = new URLSearchParams(String(options.body));
      exchanges.push(body);
      return Response.json({
        access_token: 'ephemeral-provider-token',
        token_type: 'Bearer',
        expires_in: 3600,
        id_token: token(),
      });
    }
    if (url === `${issuer}/.well-known/jwks.json`) {
      return Response.json({ keys: [jwk] });
    }
    throw new Error(`Unexpected OIDC request: ${url}`);
  };
}

describe('Telegram production OIDC adapter with local discovery and JWKS', () => {
  it('rejects discovery metadata for a different issuer', async () => {
    const client = createTelegramOidcClient(
      { clientId, clientSecret: 'testsecret', redirectUri },
      {
        fetch: async () =>
          Response.json({
            issuer: 'https://different.example',
            authorization_endpoint: `${issuer}/auth`,
            token_endpoint: `${issuer}/token`,
            jwks_uri: `${issuer}/.well-known/jwks.json`,
            response_types_supported: ['code'],
            id_token_signing_alg_values_supported: ['RS256'],
          }),
      },
    );
    await expect(
      client.authorizationUrl({
        state: 'test-state',
        nonce: 'test-nonce',
        codeChallenge: 'test-challenge',
      }),
    ).rejects.toThrow();
  });

  it('uses discovery, minimal scopes, PKCE and verifies a signed ID token', async () => {
    const exchanges: URLSearchParams[] = [];
    const client = createTelegramOidcClient(
      { clientId, clientSecret: 'testsecret', redirectUri },
      { fetch: fakeFetch(() => signedIdToken(), exchanges) },
    );
    const url = new URL(
      await client.authorizationUrl({
        state: 'test-state',
        nonce: 'test-nonce',
        codeChallenge: 'test-challenge',
      }),
    );
    expect(url.origin).toBe(issuer);
    expect(url.pathname).toBe('/auth');
    expect(url.searchParams.get('client_id')).toBe(clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(redirectUri);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid');
    expect(url.searchParams.get('state')).toBe('test-state');
    expect(url.searchParams.get('nonce')).toBe('test-nonce');
    expect(url.searchParams.get('code_challenge')).toBe('test-challenge');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');

    expect(
      await client.verifyCode({
        code: 'test-code',
        state: 'test-state',
        nonce: 'test-nonce',
        codeVerifier: 'test-verifier',
      }),
    ).toEqual({ subject: 'telegram-sub' });
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]?.get('grant_type')).toBe('authorization_code');
    expect(exchanges[0]?.get('code')).toBe('test-code');
    expect(exchanges[0]?.get('redirect_uri')).toBe(redirectUri);
    expect(exchanges[0]?.get('client_id')).toBe(clientId);
    expect(exchanges[0]?.get('code_verifier')).toBe('test-verifier');
  });

  it.each([
    ['issuer', { iss: 'https://evil.example' }],
    ['audience', { aud: 'different-client' }],
    ['expiration', { exp: Math.floor(Date.now() / 1000) - 60 }],
    ['nonce', { nonce: 'different-nonce' }],
  ])('rejects invalid %s claims', async (_name, claims) => {
    const client = createTelegramOidcClient(
      { clientId, clientSecret: 'testsecret', redirectUri },
      { fetch: fakeFetch(() => signedIdToken(claims), []) },
    );
    await expect(
      client.verifyCode({
        code: 'test-code',
        state: 'test-state',
        nonce: 'test-nonce',
        codeVerifier: 'test-verifier',
      }),
    ).rejects.toThrow();
  });

  it('rejects a tampered signature', async () => {
    const client = createTelegramOidcClient(
      { clientId, clientSecret: 'testsecret', redirectUri },
      {
        fetch: fakeFetch(() => {
          const token = signedIdToken();
          const [header, payload, encodedSignature] = token.split('.');
          if (!header || !payload || !encodedSignature) {
            throw new Error('Expected signed ID token');
          }
          const signature = Buffer.from(encodedSignature, 'base64url');
          signature[0] = (signature[0] ?? 0) ^ 1;
          return `${header}.${payload}.${signature.toString('base64url')}`;
        }, []),
      },
    );
    await expect(
      client.verifyCode({
        code: 'test-code',
        state: 'test-state',
        nonce: 'test-nonce',
        codeVerifier: 'test-verifier',
      }),
    ).rejects.toThrow();
  });
});
