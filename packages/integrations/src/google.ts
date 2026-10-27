import { OAuth2Client } from 'google-auth-library';

export interface GoogleOidcClient {
  authorizationUrl(input: { state: string; nonce: string }): string;
  verifyCode(code: string): Promise<{ subject: string; nonce: string }>;
}

export type GoogleOidcConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function createGoogleOidcClient(
  config: GoogleOidcConfig,
): GoogleOidcClient {
  const client = new OAuth2Client({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
    transporterOptions: { timeout: 10_000 },
    issuers: ['accounts.google.com', 'https://accounts.google.com'],
  });

  return {
    authorizationUrl({ state, nonce }) {
      return client.generateAuthUrl({
        response_type: 'code',
        scope: ['openid'],
        access_type: 'online',
        state,
        nonce,
      });
    },

    async verifyCode(code) {
      const { tokens } = await client.getToken({
        code,
        redirect_uri: config.redirectUri,
      });
      if (!tokens.id_token) throw new Error('Google ID token is missing');
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: config.clientId,
      });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.nonce) {
        throw new Error('Google identity claims are incomplete');
      }
      if (payload.azp && payload.azp !== config.clientId) {
        throw new Error('Google authorized presenter does not match client');
      }
      return { subject: payload.sub, nonce: payload.nonce };
    },
  };
}
