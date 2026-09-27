import {
  IdentityService,
  OAuthAttemptService,
  SessionService,
} from '@digital-autograph/auth';
import type { GoogleOidcClient } from '@digital-autograph/integrations';

export const googleLoginAttemptTtlSeconds = 600;

export type GoogleLoginResult =
  | { kind: 'success'; token: string; returnPath: string }
  | { kind: 'cancelled' | 'failed' | 'alreadyAuthenticated' };

export class GoogleLoginService {
  constructor(
    private readonly attempts: OAuthAttemptService,
    private readonly google: GoogleOidcClient,
    private readonly identities: IdentityService,
    private readonly sessions: Pick<SessionService, 'createSession'>,
  ) {}

  async start(returnPath: string): Promise<{
    authorizationUrl: string;
    browserBinding: string;
  }> {
    const attempt = await this.attempts.create('google', returnPath);
    return {
      authorizationUrl: this.google.authorizationUrl({
        state: attempt.state,
        nonce: attempt.nonce,
      }),
      browserBinding: attempt.browserBinding,
    };
  }

  async finish(input: {
    state?: string;
    browserBinding?: string;
    code?: string;
    providerError?: string;
    alreadyAuthenticated: boolean;
  }): Promise<GoogleLoginResult> {
    try {
      const attempt = await this.attempts.claim(
        'google',
        input.state,
        input.browserBinding,
      );
      if (!attempt) return { kind: 'failed' };
      if (input.alreadyAuthenticated) return { kind: 'alreadyAuthenticated' };
      if (input.providerError === 'access_denied') return { kind: 'cancelled' };
      if (input.providerError || !input.code || input.code.length > 4096) {
        return { kind: 'failed' };
      }
      const verified = await this.google.verifyCode(input.code);
      if (!this.attempts.matchesNonce(attempt.nonceHash, verified.nonce)) {
        return { kind: 'failed' };
      }
      const userId = await this.identities.resolveOrCreateUser(
        'google',
        verified.subject,
      );
      const session = await this.sessions.createSession(userId);
      return {
        kind: 'success',
        token: session.token,
        returnPath: attempt.returnPath,
      };
    } catch {
      // Provider and persistence details must never reach the callback response.
      return { kind: 'failed' };
    }
  }
}
