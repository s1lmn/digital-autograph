import * as oidc from 'openid-client';

const telegramIssuer = 'https://oauth.telegram.org';

export interface TelegramOidcClient {
  authorizationUrl(input: {
    state: string;
    nonce: string;
    codeChallenge: string;
  }): Promise<string>;
  verifyCode(input: {
    code: string;
    state: string;
    nonce: string;
    codeVerifier: string;
  }): Promise<{ subject: string }>;
}

export type TelegramOidcConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function createTelegramOidcClient(
  config: TelegramOidcConfig,
  options: { fetch?: oidc.CustomFetch } = {},
): TelegramOidcClient {
  let discovery: Promise<oidc.Configuration> | undefined;
  const configuration = () => {
    discovery ??= oidc
      .discovery(
        new URL(telegramIssuer),
        config.clientId,
        { client_secret: config.clientSecret },
        oidc.ClientSecretBasic(config.clientSecret),
        {
          ...(options.fetch ? { [oidc.customFetch]: options.fetch } : {}),
          execute: [oidc.enableNonRepudiationChecks],
        },
      )
      .catch((error: unknown) => {
        discovery = undefined;
        throw error;
      });
    return discovery;
  };

  return {
    async authorizationUrl({ state, nonce, codeChallenge }) {
      const client = await configuration();
      return oidc.buildAuthorizationUrl(client, {
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: 'openid profile',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      }).href;
    },

    async verifyCode({ code, state, nonce, codeVerifier }) {
      const client = await configuration();
      const callback = new URL(config.redirectUri);
      callback.searchParams.set('code', code);
      callback.searchParams.set('state', state);
      const tokens = await oidc.authorizationCodeGrant(
        client,
        callback,
        {
          pkceCodeVerifier: codeVerifier,
          expectedState: state,
          expectedNonce: nonce,
          idTokenExpected: true,
        },
        { client_id: config.clientId },
      );
      const subject = tokens.claims()?.sub;
      if (typeof subject !== 'string' || !subject) {
        throw new Error('Telegram identity subject is missing');
      }
      return { subject };
    },
  };
}
