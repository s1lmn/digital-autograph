import { createHash, randomBytes } from 'node:crypto';

export {
  IdentityNotAllowedError,
  IdentityService,
  type ProviderIdentityRepository,
} from './identity';
export {
  OAuthAttemptService,
  type OAuthAttemptRepository,
  type ClaimedOAuthAttempt,
  type NewOAuthAttempt,
} from './oauth-attempt';

export type AuthenticatedSession = {
  sessionId: string;
  user: { id: string; status: 'active' };
  expiresAt: Date;
};

export type PersistedSession = { id: string; userId: string; expiresAt: Date };

export interface SessionRepository {
  createForActiveUser(
    userId: string,
    secretHash: string,
    ttlSeconds: number,
  ): Promise<PersistedSession | null>;
  findActiveByHash(secretHash: string): Promise<AuthenticatedSession | null>;
  rotateActive(
    oldSecretHash: string,
    newSecretHash: string,
    ttlSeconds: number,
  ): Promise<PersistedSession | null>;
  revokeByHash(secretHash: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<void>;
}

export type IssuedSession = {
  token: string;
  sessionId: string;
  expiresAt: Date;
};

const tokenPattern = /^da_s1_[A-Za-z0-9_-]{43}$/;

function newToken(): string {
  return `da_s1_${randomBytes(32).toString('base64url')}`;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export class SessionCreationNotAllowedError extends Error {
  constructor() {
    super('Session creation requires an active user');
  }
}

export class SessionService {
  constructor(
    private readonly repository: SessionRepository,
    private readonly ttlSeconds: number,
  ) {
    if (
      !Number.isInteger(ttlSeconds) ||
      ttlSeconds < 300 ||
      ttlSeconds > 2_592_000
    ) {
      throw new Error('Invalid session TTL');
    }
  }

  async createSession(userId: string): Promise<IssuedSession> {
    const token = newToken();
    const saved = await this.repository.createForActiveUser(
      userId,
      hashToken(token),
      this.ttlSeconds,
    );
    if (!saved) throw new SessionCreationNotAllowedError();
    return { token, sessionId: saved.id, expiresAt: saved.expiresAt };
  }

  async validateSession(
    rawToken: string,
  ): Promise<AuthenticatedSession | null> {
    if (!tokenPattern.test(rawToken)) return null;
    return this.repository.findActiveByHash(hashToken(rawToken));
  }

  async rotateSession(rawToken: string): Promise<IssuedSession | null> {
    if (!tokenPattern.test(rawToken)) return null;
    const token = newToken();
    const saved = await this.repository.rotateActive(
      hashToken(rawToken),
      hashToken(token),
      this.ttlSeconds,
    );
    if (!saved) return null;
    return { token, sessionId: saved.id, expiresAt: saved.expiresAt };
  }

  async revokeSession(rawToken: string): Promise<void> {
    if (!tokenPattern.test(rawToken)) return;
    await this.repository.revokeByHash(hashToken(rawToken));
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.repository.revokeAllForUser(userId);
  }
}
