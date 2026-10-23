export type VkIdOAuthConfig = {
  clientId: string;
  serviceToken: string;
  redirectUri: string;
};
export interface VkIdOAuthClient {
  authorizationUrl(input: { state: string; codeChallenge: string }): string;
  verifyCode(input: {
    code: string;
    codeVerifier: string;
    deviceId: string;
    state: string;
  }): Promise<{ subject: string }>;
}

const maxResponseBytes = 65536;

// Keep decimal IDs lossless. Never round unsafe JSON numbers or substitute a
// profile/email, decoded ID token, legacy VK ID or callback-supplied user ID.
function subject(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error();
    return String(value);
  }
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,127}$/.test(value))
    throw new Error();
  return value;
}
async function readObject(
  response: Response,
): Promise<Record<string, unknown>> {
  if (!response.ok || !response.body) throw new Error();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > maxResponseBytes) throw new Error();
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error();
  const object = value as Record<string, unknown>;
  if ('error' in object) throw new Error();
  return object;
}

// The official confidential VK ID OAuth 2.1 contract uses service_token, not
// legacy VK client_secret. No SDK, endpoints override, refresh or token vault.
export function createVkIdOAuthClient(
  config: VkIdOAuthConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
): VkIdOAuthClient {
  const post = async (path: 'auth' | 'user_info', body: URLSearchParams) =>
    readObject(
      await fetchImpl(`https://id.vk.ru/oauth2/${path}`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      }),
    );
  return {
    authorizationUrl({ state, codeChallenge }) {
      const url = new URL('https://id.vk.ru/authorize');
      url.search = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        scope: 'vkid.personal_info',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      }).toString();
      return url.href;
    },
    async verifyCode({ code, codeVerifier, deviceId, state }) {
      try {
        const token = await post(
          'auth',
          new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: config.clientId,
            service_token: config.serviceToken,
            redirect_uri: config.redirectUri,
            code,
            code_verifier: codeVerifier,
            device_id: deviceId,
            state,
          }),
        );
        if (
          token.state !== state ||
          typeof token.token_type !== 'string' ||
          token.token_type.toLowerCase() !== 'bearer' ||
          typeof token.access_token !== 'string' ||
          !/^[A-Za-z0-9._~-]{1,4096}$/.test(token.access_token) ||
          typeof token.expires_in !== 'number' ||
          !Number.isSafeInteger(token.expires_in) ||
          token.expires_in <= 0
        )
          throw new Error();
        const tokenSubject = subject(token.user_id);
        const info = await post(
          'user_info',
          new URLSearchParams({
            client_id: config.clientId,
            access_token: token.access_token,
          }),
        );
        if (
          !info.user ||
          typeof info.user !== 'object' ||
          Array.isArray(info.user)
        )
          throw new Error();
        if (
          subject((info.user as Record<string, unknown>).user_id) !==
          tokenSubject
        )
          throw new Error();
        return { subject: tokenSubject };
      } catch {
        // Never expose provider body, tokens, service credential, code or cause.
        throw new Error('VK ID authentication failed');
      }
    },
  };
}
