export interface ProviderIdentityRepository {
  resolveOrCreateUser(
    provider: string,
    providerUserId: string,
  ): Promise<string>;
}

export class IdentityNotAllowedError extends Error {
  constructor() {
    super('Provider identity is linked to a user who cannot authenticate');
  }
}

export class IdentityService {
  constructor(private readonly repository: ProviderIdentityRepository) {}

  async resolveOrCreateUser(
    provider: string,
    providerUserId: string,
  ): Promise<string> {
    if (!provider.trim() || !providerUserId.trim()) {
      throw new Error('Verified provider identity is required');
    }
    return this.repository.resolveOrCreateUser(provider, providerUserId);
  }
}
