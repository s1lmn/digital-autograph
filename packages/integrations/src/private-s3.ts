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
  PrivateObjectTooLargeError,
  type PrivateOriginalStorage,
} from '@digital-autograph/autographs';

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
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }), {
        abortSignal: signal,
      });
    },
    async signUpload(input) {
      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: input.key,
        ContentType: input.contentType,
        IfNoneMatch: '*',
      });
      const url = await getSignedUrl(client, command, {
        expiresIn: input.expiresInSeconds,
        signableHeaders: new Set(['content-type', 'if-none-match']),
      });
      return {
        url,
        headers: { 'Content-Type': input.contentType, 'If-None-Match': '*' },
      };
    },

    async statObject(key) {
      try {
        const result = await client.send(
          new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
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
      await client.send(
        new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
      );
    },

    async getPrivateObject(key, maxBytes) {
      const controller = new AbortController();
      const result = await client.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: key }),
        { abortSignal: controller.signal },
      );
      if (!result.Body) throw new Error('Private object has no body');
      const reader = result.Body.transformToWebStream().getReader();
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          const bytes = Buffer.from(next.value);
          size += bytes.length;
          if (size > maxBytes)
            throw new PrivateObjectTooLargeError(
              'Private object exceeds byte limit',
            );
          chunks.push(bytes);
        }
      } catch (error) {
        controller.abort();
        await reader.cancel().catch(() => {});
        throw error;
      } finally {
        reader.releaseLock();
      }
      return Buffer.concat(chunks, size);
    },

    async putPrivateObject(key, bytes) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: bytes,
          ContentType: 'image/png',
        }),
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
