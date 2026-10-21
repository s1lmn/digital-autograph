import { describe, expect, it, vi } from 'vitest';
import { createYandexOAuthClient } from './yandex';

const config = {
  clientId: 'test-yandex-client',
  clientSecret: 'synthetic-client-secret',
  redirectUri: 'http://127.0.0.1:4000/auth/yandex/callback',
};
const input = { code: 'synthetic-code', codeVerifier: 'v'.repeat(43) };
const goodToken = {
  token_type: 'bearer',
  access_token: 'synthetic-access-token',
  refresh_token: 'synthetic-unused-refresh',
};
const goodInfo = {
  id: '123456789',
  client_id: config.clientId,
  default_email: 'other-user@example.test',
  login: 'mutable-name',
  default_avatar_id: 'irrelevant',
};
function client(token: unknown = goodToken, info: unknown = goodInfo) {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(token))
    .mockResolvedValueOnce(Response.json(info));
  return { adapter: createYandexOAuthClient(config, fetcher), fetcher };
}

describe('Yandex OAuth code/PKCE adapter', () => {
  it('uses exact callback, S256 and only login:info; no nonce/OIDC or implicit flow', () => {
    const { adapter } = client();
    const url = new URL(
      adapter.authorizationUrl({ state: 'state', codeChallenge: 'challenge' }),
    );
    expect(url.origin + url.pathname).toBe('https://oauth.yandex.ru/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: 'login:info',
      state: 'state',
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
    });
    expect(url.href).not.toContain(config.clientSecret);
  });
  it('exchanges on the backend and returns only app-bound immutable ID', async () => {
    const { adapter, fetcher } = client();
    expect(await adapter.verifyCode(input)).toEqual({ subject: goodInfo.id });
    const [tokenUrl, tokenOptions] = fetcher.mock.calls[0]!;
    expect(tokenUrl).toBe('https://oauth.yandex.ru/token');
    expect(tokenOptions?.redirect).toBe('error');
    expect(tokenOptions?.signal).toBeInstanceOf(AbortSignal);
    expect(tokenOptions?.headers).toEqual({
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
    });
    expect(Object.fromEntries(tokenOptions?.body as URLSearchParams)).toEqual({
      grant_type: 'authorization_code',
      code: input.code,
      code_verifier: input.codeVerifier,
    });
    expect(fetcher.mock.calls[1]).toEqual([
      'https://login.yandex.ru/info?format=json',
      expect.objectContaining({
        redirect: 'error',
        headers: { Authorization: `OAuth ${goodToken.access_token}` },
      }),
    ]);
  });
  it.each([
    {},
    { ...goodToken, token_type: 'mac' },
    { ...goodToken, access_token: 'bad\r\nheader' },
    { ...goodToken, access_token: 'x'.repeat(4097) },
  ])('rejects unsafe token shape %#', async (token) => {
    const { adapter, fetcher } = client(token);
    await expect(adapter.verifyCode(input)).rejects.toThrow(
      'Yandex authentication failed',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    {},
    { ...goodInfo, client_id: 'other-client' },
    { ...goodInfo, id: 123 },
    { ...goodInfo, id: '' },
    { ...goodInfo, id: ' account ' },
    { ...goodInfo, id: 'x'.repeat(129) },
    { ...goodInfo, id: 'email@example.test' },
  ])('rejects untrusted identity shape %#', async (info) => {
    await expect(
      client(goodToken, info).adapter.verifyCode(input),
    ).rejects.toThrow('Yandex authentication failed');
  });
  it.each([400, 401, 429, 500, 302])(
    'redacts provider errors and redirects (%i)',
    async (status) => {
      const adapter = createYandexOAuthClient(
        config,
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            new Response('synthetic-sensitive-provider-error', { status }),
          ),
      );
      try {
        await adapter.verifyCode(input);
        throw new Error('Expected rejection');
      } catch (error) {
        expect(String(error)).toBe('Error: Yandex authentication failed');
        expect((error as Error).cause).toBeUndefined();
      }
    },
  );
  it('redacts network errors without retaining causes', async () => {
    const adapter = createYandexOAuthClient(
      config,
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new Error('synthetic-sensitive-network-context')),
    );
    await expect(adapter.verifyCode(input)).rejects.toThrow(
      /^Yandex authentication failed$/,
    );
  });
  it('rejects oversized or malformed JSON responses', async () => {
    for (const body of ['x'.repeat(65537), '{', '[]']) {
      const adapter = createYandexOAuthClient(
        config,
        vi.fn<typeof fetch>().mockResolvedValue(new Response(body)),
      );
      await expect(adapter.verifyCode(input)).rejects.toThrow(
        /^Yandex authentication failed$/,
      );
    }
  });
});
