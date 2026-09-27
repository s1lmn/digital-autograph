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
    assetId: string,
    actualSizeBytes: number,
  ): Promise<AutographView>;
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
}

export type AutographErrorCode =
  | 'AUTOGRAPH_NOT_FOUND'
  | 'FORBIDDEN'
  | 'INVALID_AUTOGRAPH_STATE'
  | 'INVALID_UPLOAD'
  | 'UPLOAD_NOT_FOUND'
  | 'UPLOAD_TOO_LARGE'
  | 'UPLOAD_METADATA_MISMATCH';

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
  ) {
    if (
      !Number.isInteger(uploadTtlSeconds) ||
      uploadTtlSeconds < 60 ||
      uploadTtlSeconds > 600
    ) {
      throw new Error('Invalid upload URL lifetime');
    }
  }

  create(userId: string, source: AutographSource): Promise<AutographView> {
    return this.repository.create(userId, source);
  }

  get(userId: string, autographId: string): Promise<AutographView> {
    return this.repository.findOwned(userId, autographId);
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
    const target = await this.repository.completionTarget(userId, autographId);
    if (target.status === 'uploaded')
      return this.repository.findOwned(userId, autographId);
    const object = await this.storage.statObject(target.storageKey);
    if (!object) throw new AutographError('UPLOAD_NOT_FOUND');
    if (object.sizeBytes < 1 || object.sizeBytes > maxOriginalBytes) {
      throw new AutographError('UPLOAD_TOO_LARGE');
    }
    if (
      object.sizeBytes !== target.expectedSizeBytes ||
      object.contentType !== target.expectedContentType
    ) {
      throw new AutographError('UPLOAD_METADATA_MISMATCH');
    }
    return this.repository.completeOriginal(
      userId,
      autographId,
      target.id,
      object.sizeBytes,
    );
  }
}
