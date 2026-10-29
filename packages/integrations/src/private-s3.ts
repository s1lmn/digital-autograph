import {
  CreateBucketCommand,
  DeleteBucketPolicyCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  AutographError,
  maxOriginalBytes,
  type PrivateOriginalStorage,
} from '@digital-autograph/autographs';
import { readPrivateObject } from './private-object-read';
import { privateObjectOperation } from './private-object-operation';

export type PrivateS3Config = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
};

export function createPrivateS3Storage(
  config: PrivateS3Config,
): PrivateOriginalStorage & {
  bootstrapLocalBucket(): Promise<void>;
  checkConnection(signal: AbortSignal): Promise<void>;
  close(): void;
} {
  const client = new S3Client({
    region: config.region,
    ...(config.endpoint && { endpoint: config.endpoint, forcePathStyle: true }),
    ...(config.accessKeyId &&
      config.secretAccessKey && {
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      }),
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });

  return {
    async checkConnection(signal) {
      await privateObjectOperation(
        (boundedSignal) =>
          client.send(new HeadBucketCommand({ Bucket: config.bucket }), {
            abortSignal: boundedSignal,
          }),
        signal,
      );
    },
    async putOriginal(input) {
      if (input.bytes.length < 1 || input.bytes.length > maxOriginalBytes)
        throw new AutographError('UPLOAD_TOO_LARGE');
      try {
        await privateObjectOperation(
          (signal) =>
            client.send(
              new PutObjectCommand({
                Bucket: config.bucket,
                Key: input.key,
                Body: input.bytes,
                ContentType: input.contentType,
                ContentLength: input.bytes.length,
                IfNoneMatch: '*',
              }),
              { abortSignal: signal },
            ),
          input.signal,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          '$metadata' in error &&
          (error.$metadata as { httpStatusCode?: number }).httpStatusCode ===
            412
        )
          throw new AutographError('UPLOAD_ALREADY_EXISTS');
        throw error;
      }
    },

    async statObject(key) {
      try {
        const result = await privateObjectOperation((signal) =>
          client.send(
            new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
            { abortSignal: signal },
          ),
        );
        return {
          sizeBytes: result.ContentLength ?? -1,
          contentType: result.ContentType ?? null,
        };
      } catch (error) {
        if (
          error instanceof Error &&
          '$metadata' in error &&
          (error.$metadata as { httpStatusCode?: number }).httpStatusCode ===
            404
        )
          return null;
        throw error;
      }
    },

    async deleteObject(key) {
      await privateObjectOperation((signal) =>
        client.send(
          new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
          { abortSignal: signal },
        ),
      );
    },

    async getPrivateObject(key, maxBytes) {
      return readPrivateObject(
        (signal) =>
          client.send(
            new GetObjectCommand({ Bucket: config.bucket, Key: key }),
            { abortSignal: signal },
          ),
        maxBytes,
      );
    },

    async putPrivateObject(key, bytes) {
      await privateObjectOperation((signal) =>
        client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: bytes,
            ContentType: 'image/png',
            ContentLength: bytes.length,
            IfNoneMatch: '*',
          }),
          { abortSignal: signal },
        ),
      );
    },

    async signPrivateRead(key, expiresInSeconds) {
      return getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: config.bucket, Key: key }),
        { expiresIn: expiresInSeconds },
      );
    },

    async bootstrapLocalBucket() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !('$metadata' in error) ||
          (error.$metadata as { httpStatusCode?: number }).httpStatusCode !==
            404
        )
          throw error;
        await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
      }
      try {
        await client.send(
          new DeleteBucketPolicyCommand({ Bucket: config.bucket }),
        );
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !['NoSuchBucketPolicy', 'NoSuchBucketPolicyException'].includes(
            error.name,
          )
        ) {
          throw error;
        }
      }
    },

    close() {
      client.destroy();
    },
  };
}
