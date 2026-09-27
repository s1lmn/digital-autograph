import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type StoredOAuthAttempt = {
  id: string;
  browserBindingHash: string;
  nonceHash: string;
  returnPath: string;
};

export interface OAuthAttemptRepository {
  create(input: {
    provider: string;
    stateHash: string;
    browserBindingHash: string;
    nonceHash: string;
    returnPath: string;
    ttlSeconds: number;
  }): Promise<void>;
  findActive(
    provider: string,
    stateHash: string,
  ): Promise<StoredOAuthAttempt | null>;
  consume(id: string): Promise<boolean>;
}

export type NewOAuthAttempt = {
  state: string;
  browserBinding: string;
  nonce: string;
};

export type ClaimedOAuthAttempt = {
  nonceHash: string;
  returnPath: string;
};

const secretPattern = /^[A-Za-z0-9_-]{43}$/;

function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

function hashSecret(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === 32 && b.length === 32 && timingSafeEqual(a, b);
}

export class OAuthAttemptService {
  constructor(
    private readonly repository: OAuthAttemptRepository,
    private readonly ttlSeconds: number,
  ) {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 900) {
      throw new Error('Invalid OAuth attempt TTL');
    }
  }

  async create(provider: string, returnPath: string): Promise<NewOAuthAttempt> {
    const state = newSecret();
    const browserBinding = newSecret();
    const nonce = newSecret();
    await this.repository.create({
      provider,
      stateHash: hashSecret(state),
      browserBindingHash: hashSecret(browserBinding),
      nonceHash: hashSecret(nonce),
      returnPath,
      ttlSeconds: this.ttlSeconds,
    });
    return { state, browserBinding, nonce };
  }

  async claim(
    provider: string,
    state: string | undefined,
    browserBinding: string | undefined,
  ): Promise<ClaimedOAuthAttempt | null> {
    if (
      !state ||
      !browserBinding ||
      !secretPattern.test(state) ||
      !secretPattern.test(browserBinding)
    ) {
      return null;
    }
    const attempt = await this.repository.findActive(
      provider,
      hashSecret(state),
    );
    if (
      !attempt ||
      !sameHash(attempt.browserBindingHash, hashSecret(browserBinding))
    ) {
      return null;
    }
    if (!(await this.repository.consume(attempt.id))) return null;
    return { nonceHash: attempt.nonceHash, returnPath: attempt.returnPath };
  }

  matchesNonce(nonceHash: string, nonce: string | undefined): boolean {
    return !!nonce && sameHash(nonceHash, hashSecret(nonce));
  }
}
