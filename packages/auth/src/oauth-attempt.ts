import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type StoredOAuthAttempt = {
  id: string;
  browserBindingHash: string;
  nonceHash: string;
  pkceVerifierHash: string | null;
  returnPath: string;
};

export interface OAuthAttemptRepository {
  create(input: {
    provider: string;
    stateHash: string;
    browserBindingHash: string;
    nonceHash: string;
    pkceVerifierHash: string | null;
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

export type NewPkceOAuthAttempt = NewOAuthAttempt & {
  codeVerifier: string;
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
    return this.createAttempt(provider, returnPath, null);
  }

  async createPkce(
    provider: string,
    returnPath: string,
  ): Promise<NewPkceOAuthAttempt> {
    const codeVerifier = newSecret();
    const attempt = await this.createAttempt(
      provider,
      returnPath,
      codeVerifier,
    );
    return { ...attempt, codeVerifier };
  }

  private async createAttempt(
    provider: string,
    returnPath: string,
    codeVerifier: string | null,
  ): Promise<NewOAuthAttempt> {
    const state = newSecret();
    const browserBinding = newSecret();
    const nonce = newSecret();
    await this.repository.create({
      provider,
      stateHash: hashSecret(state),
      browserBindingHash: hashSecret(browserBinding),
      nonceHash: hashSecret(nonce),
      pkceVerifierHash: codeVerifier ? hashSecret(codeVerifier) : null,
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
    return this.claimAttempt(provider, state, browserBinding);
  }

  async claimPkce(
    provider: string,
    state: string | undefined,
    browserBinding: string | undefined,
    codeVerifier: string | undefined,
    nonce: string | undefined,
  ): Promise<ClaimedOAuthAttempt | null> {
    if (
      !codeVerifier ||
      !nonce ||
      !secretPattern.test(codeVerifier) ||
      !secretPattern.test(nonce)
    ) {
      return null;
    }
    return this.claimAttempt(provider, state, browserBinding, {
      codeVerifier,
      nonce,
    });
  }

  private async claimAttempt(
    provider: string,
    state: string | undefined,
    browserBinding: string | undefined,
    pkce?: { codeVerifier: string; nonce: string },
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
      !sameHash(attempt.browserBindingHash, hashSecret(browserBinding)) ||
      (pkce
        ? !attempt.pkceVerifierHash ||
          !sameHash(attempt.pkceVerifierHash, hashSecret(pkce.codeVerifier)) ||
          !sameHash(attempt.nonceHash, hashSecret(pkce.nonce))
        : attempt.pkceVerifierHash !== null)
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
