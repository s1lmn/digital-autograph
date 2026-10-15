import { createHash } from 'node:crypto';
import {
  IdentityService,
  OAuthAttemptService,
  SessionService,
} from '@digital-autograph/auth';
import type { VkIdOAuthClient } from '@digital-autograph/integrations';

export const vkIdLoginAttemptTtlSeconds = 600;
export type VkIdLoginResult =
  | { kind: 'success'; token: string; returnPath: string }
  | { kind: 'cancelled' | 'failed' | 'alreadyAuthenticated' };

export class VkIdLoginService {
  constructor(
    private readonly attempts: OAuthAttemptService,
    private readonly vkId: VkIdOAuthClient,
    private readonly identities: IdentityService,
    private readonly sessions: Pick<SessionService, 'createSession'>,
  ) {}

  async start(returnPath: string) {
    const attempt = await this.attempts.createPkce('vk_id', returnPath);
    return {
      authorizationUrl: this.vkId.authorizationUrl({
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
    deviceId?: string;
    providerError?: string;
    alreadyAuthenticated: boolean;
  }): Promise<VkIdLoginResult> {
    try {
      const attempt = await this.attempts.claimOAuthPkce(
        'vk_id',
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
        !input.codeVerifier ||
        !input.deviceId ||
        !/^[\x21-\x7e]{1,1024}$/.test(input.deviceId)
      )
        return { kind: 'failed' };
      const verified = await this.vkId.verifyCode({
        code: input.code,
        codeVerifier: input.codeVerifier,
        deviceId: input.deviceId,
        state: input.state!,
      });
      // Defense in depth for the trusted adapter boundary, never email/name matching.
      if (!/^[1-9][0-9]{0,127}$/.test(verified.subject))
        return { kind: 'failed' };
      const userId = await this.identities.resolveOrCreateUser(
        'vk_id',
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
