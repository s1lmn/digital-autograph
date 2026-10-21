export type YandexOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export interface YandexOAuthClient {
  authorizationUrl(input: { state: string; codeChallenge: string }): string;
  verifyCode(input: {
    code: string;
    codeVerifier: string;
  }): Promise<{ subject: string }>;
}

const maxResponseBytes = 65536;
const subjectPattern = /^[A-Za-z0-9_-]{1,128}$/;

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
  return value as Record<string, unknown>;
}

// Dependency injection is in-process for tests only. No configurable endpoints,
// issuer URLs or browser token exchange are exposed by the application.
export function createYandexOAuthClient(
  config: YandexOAuthConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
): YandexOAuthClient {
  return {
    authorizationUrl({ state, codeChallenge }) {
      const url = new URL('https://oauth.yandex.ru/authorize');
      url.search = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        scope: 'login:info',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      }).toString();
      return url.href;
    },
    async verifyCode({ code, codeVerifier }) {
      try {
        const token = await readObject(
          await fetchImpl('https://oauth.yandex.ru/token', {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(10000),
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
            },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code,
              code_verifier: codeVerifier,
            }),
          }),
        );
        if (
          token.token_type !== 'bearer' ||
          typeof token.access_token !== 'string' ||
          !/^[A-Za-z0-9._~-]{1,4096}$/.test(token.access_token)
        )
          throw new Error();
        // Only this ephemeral access token is read; refresh tokens and profiles
        // never become application state. Yandex OAuth has no OIDC nonce here.
        const info = await readObject(
          await fetchImpl('https://login.yandex.ru/info?format=json', {
            method: 'GET',
            redirect: 'error',
            signal: AbortSignal.timeout(10000),
            headers: { Authorization: `OAuth ${token.access_token}` },
          }),
        );
        if (
          info.client_id !== config.clientId ||
          typeof info.id !== 'string' ||
          !subjectPattern.test(info.id)
        )
          throw new Error();
        return { subject: info.id };
      } catch {
        // No provider response, request body, token, code or error cause escapes.
        throw new Error('Yandex authentication failed');
      }
    },
  };
}
