import type {
  AutographSource,
  ModerationRejectionReason,
} from '@digital-autograph/domain';
import type { PrivateOriginalStorage } from './index';

export type ModerationRequest =
  | { decision: 'approved' }
  | { decision: 'rejected'; reasonCode: ModerationRejectionReason };

export type ModerationQueueItem = {
  id: string;
  source: AutographSource;
  approvedAt: Date;
  createdAt: Date;
};

export type ModerationResult = {
  id: string;
  status: 'ready' | 'moderation_rejected';
  decision: 'approved' | 'rejected';
  reasonCode: ModerationRejectionReason | null;
  decidedAt: Date;
};

export interface ModerationRepository {
  list(
    moderatorUserId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: ModerationQueueItem[]; nextCursor: string | null }>;
  previewTarget(
    moderatorUserId: string,
    autographId: string,
  ): Promise<{ key: string }>;
  decide(
    moderatorUserId: string,
    autographId: string,
    request: ModerationRequest,
  ): Promise<ModerationResult>;
}

export class ModerationService {
  constructor(
    private readonly repository: ModerationRepository,
    private readonly storage: Pick<PrivateOriginalStorage, 'signPrivateRead'>,
    private readonly previewTtlSeconds = 120,
    private readonly clock: () => Date = () => new Date(),
  ) {
    if (
      !Number.isInteger(previewTtlSeconds) ||
      previewTtlSeconds < 60 ||
      previewTtlSeconds > 300
    ) {
      throw new Error('Invalid moderator preview URL lifetime');
    }
  }

  list(moderatorUserId: string, limit: number, cursor?: string) {
    return this.repository.list(moderatorUserId, limit, cursor);
  }

  async preview(moderatorUserId: string, autographId: string) {
    const target = await this.repository.previewTarget(
      moderatorUserId,
      autographId,
    );
    return {
      url: await this.storage.signPrivateRead(
        target.key,
        this.previewTtlSeconds,
      ),
      expiresAt: new Date(
        this.clock().getTime() + this.previewTtlSeconds * 1000,
      ),
    };
  }

  decide(
    moderatorUserId: string,
    autographId: string,
    request: ModerationRequest,
  ) {
    return this.repository.decide(moderatorUserId, autographId, request);
  }
}
