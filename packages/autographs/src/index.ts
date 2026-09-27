import { randomUUID } from 'node:crypto';
import type {
  AutographSource,
  AutographStatus,
} from '@digital-autograph/domain';

export const maxOriginalBytes = 10 * 1024 * 1024;
export const allowedOriginalTypes = ['image/png', 'image/jpeg'] as const;
export type OriginalContentType = (typeof allowedOriginalTypes)[number];

export type AutographView = {
  id: string;
  source: AutographSource;
  status: AutographStatus;
  createdAt: Date;
  updatedAt: Date;
  approvedAt: Date | null;
  original: null | {
    id: string;
    status: 'reserved' | 'uploaded';
    expectedContentType: OriginalContentType;
    expectedSizeBytes: number;
    verifiedSizeBytes: number | null;
    uploadExpiresAt: Date;
    uploadedAt: Date | null;
  };
};

export type ReservedOriginal = {
  id: string;
  autographId: string;
  storageKey: string;
  expectedContentType: OriginalContentType;
  expectedSizeBytes: number;
  uploadExpiresAt: Date;
  status: 'reserved' | 'uploaded';
};

export interface AutographRepository {
  create(userId: string, source: AutographSource): Promise<AutographView>;
  findOwned(userId: string, autographId: string): Promise<AutographView>;
  reserveOriginal(
    userId: string,
    autographId: string,
    input: {
      assetId: string;
      storageKey: string;
      contentType: OriginalContentType;
      sizeBytes: number;
      expiresAt: Date;
    },
  ): Promise<ReservedOriginal>;
  completionTarget(
    userId: string,
    autographId: string,
  ): Promise<ReservedOriginal>;
  completeOriginal(
    userId: string,
    autographId: string,
    verify: (asset: ReservedOriginal) => Promise<number>,
  ): Promise<AutographView>;
  cleanedAssetPreview(
    userId: string,
    autographId: string,
  ): Promise<{ assetId: string; key: string } | null>;
  approveOwnedAutograph(
    userId: string,
    autographId: string,
    reviewedAssetId: string,
  ): Promise<{ id: string; status: 'awaiting_moderation'; approvedAt: Date }>;
}

export interface PrivateOriginalStorage {
  signUpload(input: {
    key: string;
    contentType: OriginalContentType;
    expiresInSeconds: number;
  }): Promise<{ url: string; headers: Record<string, string> }>;
  statObject(
    key: string,
  ): Promise<{ sizeBytes: number; contentType: string | null } | null>;
  deleteObject(key: string): Promise<void>;
  signPrivateRead(key: string, expiresInSeconds: number): Promise<string>;
  getPrivateObject(key: string, maxBytes: number): Promise<Buffer>;
  putPrivateObject(key: string, bytes: Buffer): Promise<void>;
}

export class PrivateObjectTooLargeError extends Error {}

export type AutographErrorCode =
  | 'AUTOGRAPH_NOT_FOUND'
  | 'FORBIDDEN'
  | 'INVALID_AUTOGRAPH_STATE'
  | 'INVALID_UPLOAD'
  | 'UPLOAD_NOT_FOUND'
  | 'UPLOAD_TOO_LARGE'
  | 'UPLOAD_METADATA_MISMATCH'
  | 'CLEANED_PREVIEW_NOT_AVAILABLE'
  | 'AUTOGRAPH_NOT_AWAITING_APPROVAL'
  | 'CLEANED_ASSET_NOT_AVAILABLE'
  | 'REVIEWED_ASSET_MISMATCH'
  | 'APPROVAL_STATE_INCONSISTENT';

export class AutographError extends Error {
  constructor(readonly code: AutographErrorCode) {
    super(code);
  }
}

export class AutographService {
  constructor(
    private readonly repository: AutographRepository,
    private readonly storage: PrivateOriginalStorage,
    private readonly uploadTtlSeconds: number,
    private readonly clock: () => Date = () => new Date(),
    private readonly previewTtlSeconds = 120,
  ) {
    if (
      !Number.isInteger(uploadTtlSeconds) ||
      uploadTtlSeconds < 60 ||
      uploadTtlSeconds > 600
    ) {
      throw new Error('Invalid upload URL lifetime');
    }
    if (
      !Number.isInteger(previewTtlSeconds) ||
      previewTtlSeconds < 60 ||
      previewTtlSeconds > 300
    ) {
      throw new Error('Invalid preview URL lifetime');
    }
  }

  create(userId: string, source: AutographSource): Promise<AutographView> {
    return this.repository.create(userId, source);
  }

  get(userId: string, autographId: string): Promise<AutographView> {
    return this.repository.findOwned(userId, autographId);
  }

  approveCleanedAutograph(
    userId: string,
    autographId: string,
    reviewedAssetId: string,
  ) {
    return this.repository.approveOwnedAutograph(
      userId,
      autographId,
      reviewedAssetId,
    );
  }

  async initiateUpload(
    userId: string,
    autographId: string,
    input: { contentType: OriginalContentType; sizeBytes: number },
  ) {
    if (
      !allowedOriginalTypes.includes(input.contentType) ||
      !Number.isInteger(input.sizeBytes) ||
      input.sizeBytes < 1 ||
      input.sizeBytes > maxOriginalBytes
    ) {
      throw new AutographError('INVALID_UPLOAD');
    }
    const assetId = randomUUID();
    const reserved = await this.repository.reserveOriginal(
      userId,
      autographId,
      {
        assetId,
        storageKey: `autographs/${autographId}/original/${assetId}`,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        expiresAt: new Date(
          this.clock().getTime() + this.uploadTtlSeconds * 1000,
        ),
      },
    );
    const signed = await this.storage.signUpload({
      key: reserved.storageKey,
      contentType: reserved.expectedContentType,
      expiresInSeconds: this.uploadTtlSeconds,
    });
    return {
      assetId: reserved.id,
      method: 'PUT' as const,
      url: signed.url,
      headers: signed.headers,
      expiresAt: reserved.uploadExpiresAt,
    };
  }

  async completeUpload(
    userId: string,
    autographId: string,
  ): Promise<AutographView> {
    return this.repository.completeOriginal(
      userId,
      autographId,
      async (target) => {
        const object = await this.storage.statObject(target.storageKey);
        if (!object) throw new AutographError('UPLOAD_NOT_FOUND');
        let failure: AutographErrorCode | null = null;
        if (object.sizeBytes < 1 || object.sizeBytes > maxOriginalBytes) {
          failure = 'UPLOAD_TOO_LARGE';
        } else if (
          object.sizeBytes !== target.expectedSizeBytes ||
          object.contentType !== target.expectedContentType
        ) {
          failure = 'UPLOAD_METADATA_MISMATCH';
        }
        if (failure) {
          try {
            await this.storage.deleteObject(target.storageKey);
          } catch {
            console.warn('Rejected private upload cleanup failed', {
              autographId,
              assetId: target.id,
            });
          }
          throw new AutographError(failure);
        }
        return object.sizeBytes;
      },
    );
  }

  async preview(userId: string, autographId: string) {
    const asset = await this.repository.cleanedAssetPreview(
      userId,
      autographId,
    );
    if (!asset) throw new AutographError('CLEANED_PREVIEW_NOT_AVAILABLE');
    return {
      assetId: asset.assetId,
      url: await this.storage.signPrivateRead(
        asset.key,
        this.previewTtlSeconds,
      ),
      expiresAt: new Date(
        this.clock().getTime() + this.previewTtlSeconds * 1000,
      ),
    };
  }
}
