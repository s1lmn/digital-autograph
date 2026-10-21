import { createHash } from 'node:crypto';
import {
  IdentityService,
  OAuthAttemptService,
  SessionService,
} from '@digital-autograph/auth';
import type { YandexOAuthClient } from '@digital-autograph/integrations';

export const yandexLoginAttemptTtlSeconds = 600;
export type YandexLoginResult =
  | { kind: 'success'; token: string; returnPath: string }
  | { kind: 'cancelled' | 'failed' | 'alreadyAuthenticated' };

export class YandexLoginService {
  constructor(
    private readonly attempts: OAuthAttemptService,
    private readonly yandex: YandexOAuthClient,
    private readonly identities: IdentityService,
    private readonly sessions: Pick<SessionService, 'createSession'>,
  ) {}

  async start(returnPath: string) {
    const attempt = await this.attempts.createPkce('yandex', returnPath);
    return {
      authorizationUrl: this.yandex.authorizationUrl({
        state: attempt.state,
        codeChallenge: createHash('sha256')
          .update(attempt.codeVerifier)
          .digest('base64url'),
      }),
      browserBinding: attempt.browserBinding,
      codeVerifier: attempt.codeVerifier,
    };
  }

  async finish(input: {
    state?: string;
    browserBinding?: string;
    codeVerifier?: string;
    code?: string;
    providerError?: string;
    alreadyAuthenticated: boolean;
  }): Promise<YandexLoginResult> {
    try {
      const attempt = await this.attempts.claimOAuthPkce(
        'yandex',
        input.state,
        input.browserBinding,
        input.codeVerifier,
      );
      if (!attempt) return { kind: 'failed' };
      if (input.alreadyAuthenticated) return { kind: 'alreadyAuthenticated' };
      if (input.providerError === 'access_denied' && !input.code)
        return { kind: 'cancelled' };
      if (
        input.providerError ||
        !input.code ||
        input.code.length > 4096 ||
        !input.codeVerifier
      )
        return { kind: 'failed' };
      const verified = await this.yandex.verifyCode({
        code: input.code,
        codeVerifier: input.codeVerifier,
      });
      // Defense in depth for the trusted adapter boundary, never email/name matching.
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(verified.subject))
        return { kind: 'failed' };
      const userId = await this.identities.resolveOrCreateUser(
        'yandex',
        verified.subject,
      );
      const session = await this.sessions.createSession(userId);
      return {
        kind: 'success',
        token: session.token,
        returnPath: attempt.returnPath,
      };
    } catch {
      return { kind: 'failed' };
    }
  }
}
