import { describe, expect, it, vi } from 'vitest';
import { createVkIdOAuthClient } from './vk-id';
const config = {
  clientId: '123456',
  serviceToken: 'synthetic-service-token',
  redirectUri: 'http://127.0.0.1:4000/auth/vk-id/callback',
};
const input = {
  code: 'synthetic-code',
  codeVerifier: 'v'.repeat(43),
  state: 's'.repeat(43),
  deviceId: 'synthetic-device',
};
const goodToken = {
  token_type: 'Bearer',
  access_token: 'synthetic-access-token',
  expires_in: 600,
  user_id: 123456789,
  state: input.state,
  id_token: 'not-a-trusted-identity',
  refresh_token: 'unused',
};
const goodInfo = {
  user: {
    user_id: '123456789',
    email: 'other@example.test',
    first_name: 'mutable',
    avatar: 'irrelevant',
  },
};
function client(token: unknown = goodToken, info: unknown = goodInfo) {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(token))
    .mockResolvedValueOnce(Response.json(info));
  return { adapter: createVkIdOAuthClient(config, fetcher), fetcher };
}
describe('VK ID confidential code/PKCE contract', () => {
  it('uses OAuth 2.1 S256, minimal scope, exact redirect and no secret/SDK/legacy flow', () => {
    const url = new URL(
      client().adapter.authorizationUrl({
        state: input.state,
        codeChallenge: 'challenge',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://id.vk.ru/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: 'vkid.personal_info',
      state: input.state,
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
    });
    expect(url.href).not.toContain(config.serviceToken);
  });
  it('exchanges code with service_token, state and device_id in POST body; confirms matching user_info', async () => {
    const { adapter, fetcher } = client();
    expect(await adapter.verifyCode(input)).toEqual({ subject: '123456789' });
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://id.vk.ru/oauth2/auth');
    expect(options).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(Object.fromEntries(options?.body as URLSearchParams)).toEqual({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      service_token: config.serviceToken,
      redirect_uri: config.redirectUri,
      code: input.code,
      code_verifier: input.codeVerifier,
      device_id: input.deviceId,
      state: input.state,
    });
    expect(fetcher.mock.calls[1]![0]).toBe('https://id.vk.ru/oauth2/user_info');
    const infoOptions = fetcher.mock.calls[1]![1];
    expect(infoOptions).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(Object.fromEntries(infoOptions?.body as URLSearchParams)).toEqual({
      client_id: config.clientId,
      access_token: goodToken.access_token,
    });
  });
  it.each([
    {},
    { ...goodToken, state: 'wrong' },
    { ...goodToken, state: undefined },
    { ...goodToken, token_type: 'mac' },
    { ...goodToken, access_token: 'bad\r\nheader' },
    { ...goodToken, access_token: 'x'.repeat(4097) },
    { ...goodToken, expires_in: 0 },
    { ...goodToken, user_id: undefined },
    { ...goodToken, user_id: Number.MAX_SAFE_INTEGER + 1 },
    { ...goodToken, user_id: 0 },
    { ...goodToken, user_id: 'email@example.test' },
    { ...goodToken, error: 'access_denied' },
  ])('rejects untrusted token/identity %# before user_info', async (token) => {
    const { adapter, fetcher } = client(token);
    await expect(adapter.verifyCode(input)).rejects.toThrow(
      'VK ID authentication failed',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    {},
    { user: {} },
    { user: { user_id: '987654321' } },
    { user: { user_id: 0 } },
    { user: { user_id: Number.MAX_SAFE_INTEGER + 1 } },
    { user: { user_id: '0123456789' } },
    { user: { user_id: 'email@example.test' } },
    { user: { user_id: 'x'.repeat(129) } },
    { ...goodInfo, error: 'bad' },
    { user: [] },
  ])('rejects missing/unconfirmed or mismatched identity %#', async (info) => {
    await expect(
      client(goodToken, info).adapter.verifyCode(input),
    ).rejects.toThrow('VK ID authentication failed');
  });
  it('keeps large decimal strings lossless and accepts only safe numeric IDs', async () => {
    const id = '9007199254740993';
    expect(
      await client(
        { ...goodToken, user_id: id },
        { user: { user_id: id } },
      ).adapter.verifyCode(input),
    ).toEqual({ subject: id });
  });
  it.each([400, 401, 429, 500, 302])(
    'redacts failed provider/network/redirect responses %i',
    async (status) => {
      const adapter = createVkIdOAuthClient(
        config,
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response('synthetic-sensitive', { status })),
      );
      try {
        await adapter.verifyCode(input);
        throw new Error('Expected failure');
      } catch (error) {
        expect(String(error)).toBe('Error: VK ID authentication failed');
        expect((error as Error).cause).toBeUndefined();
      }
    },
  );
  it('redacts network exceptions and rejects oversized/malformed JSON at either boundary', async () => {
    const failing = createVkIdOAuthClient(
      config,
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new Error('synthetic-private-network')),
    );
    await expect(failing.verifyCode(input)).rejects.toThrow(
      /^VK ID authentication failed$/,
    );
    for (const stage of ['token', 'info'])
      for (const body of ['x'.repeat(65537), '{', '[]']) {
        const fetcher = vi.fn<typeof fetch>();
        if (stage === 'info')
          fetcher.mockResolvedValueOnce(Response.json(goodToken));
        fetcher.mockResolvedValueOnce(new Response(body));
        await expect(
          createVkIdOAuthClient(config, fetcher).verifyCode(input),
        ).rejects.toThrow(/^VK ID authentication failed$/);
      }
  });
});
