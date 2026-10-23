import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
  chmod,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export function validateRecoveryEndpoint(
  endpoint: string,
  environment: string,
) {
  if (!/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(endpoint))
    throw new Error('Literal loopback test storage required');
  const url = new URL(endpoint);
  if (
    environment !== 'test' ||
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Isolated loopback test storage required');
  return url.origin;
}

export function verifyRecoveryBytes(bytes: Uint8Array, digest: string) {
  if (
    bytes.length !== 96 ||
    !/^[a-f0-9]{64}$/.test(digest) ||
    createHash('sha256').update(bytes).digest('hex') !== digest
  ) {
    throw new Error('Synthetic archive integrity failed');
  }
}

// Not an application backup API. It can only create fresh synthetic test buckets.
export async function runPrivateStorageRecoveryDrill(config: {
  endpoint: string;
  environment: string;
  accessKeyId: string;
  secretAccessKey: string;
}) {
  const endpoint = validateRecoveryEndpoint(
    config.endpoint,
    config.environment,
  );
  const client = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
  const buckets = ['source', 'backup', 'restore'].map(
    (role) => `recovery-${role}-${randomUUID()}`,
  );
  const created: string[] = [];
  const key = 'synthetic-object.bin';
  const bytes = randomBytes(96);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const base = await realpath(tmpdir());
  let directory: string | undefined;
  const started = performance.now();
  const options = () => ({ abortSignal: AbortSignal.timeout(5000) });
  let completed = false;
  let cleanupFailed = false;
  async function get(bucket: string) {
    const response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(5000) },
    );
    if (response.ContentLength !== 96 || !response.Body)
      throw new Error('Invalid synthetic object');
    const result = await response.Body.transformToByteArray();
    verifyRecoveryBytes(result, digest);
    return result;
  }
  try {
    directory = await mkdtemp(join(base, 'da-recovery-'));
    await chmod(directory, 0o700);
    for (const bucket of buckets) {
      await client.send(new CreateBucketCommand({ Bucket: bucket }), options());
      created.push(bucket);
    }
    const [source, backup, restore] = buckets as [string, string, string];
    await client.send(
      new PutObjectCommand({
        Bucket: source,
        Key: key,
        Body: bytes,
        ContentType: 'application/octet-stream',
        IfNoneMatch: '*',
      }),
      options(),
    );
    const archive = join(directory, 'synthetic-object.bin');
    await writeFile(archive, await get(source), { flag: 'wx', mode: 0o600 });
    const archived = await readFile(archive);
    verifyRecoveryBytes(archived, digest);
    await client.send(
      new PutObjectCommand({
        Bucket: backup,
        Key: key,
        Body: archived,
        IfNoneMatch: '*',
      }),
      options(),
    );
    await client.send(
      new PutObjectCommand({
        Bucket: restore,
        Key: key,
        Body: await get(backup),
        IfNoneMatch: '*',
      }),
      options(),
    );
    await get(restore);
    await get(source);
    for (const bucket of buckets) {
      const response = await fetch(`${endpoint}/${bucket}/${key}`, {
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      await response.body?.cancel();
      if (response.status !== 403)
        throw new Error('Synthetic object must deny unsigned reads');
    }
    completed = true;
  } catch {
    completed = false;
  } finally {
    for (const bucket of created.reverse()) {
      try {
        await client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: key }),
          options(),
        );
        await client.send(
          new DeleteBucketCommand({ Bucket: bucket }),
          options(),
        );
      } catch {
        cleanupFailed = true;
      }
    }
    client.destroy();
    try {
      if (directory) {
        if (
          dirname(directory) !== base ||
          !basename(directory).startsWith('da-recovery-')
        ) {
          cleanupFailed = true;
        } else {
          await rm(directory, { recursive: true, force: true });
        }
      }
    } catch {
      cleanupFailed = true;
    }
  }
  if (!completed || cleanupFailed)
    throw new Error('Synthetic storage recovery or cleanup failed');
  return {
    event: 'SYNTHETIC_PRIVATE_STORAGE_RECOVERY_PASS',
    objectBytes: 96,
    sha256Verified: true,
    unsignedReadDenied: true,
    totalMilliseconds: Math.round(performance.now() - started),
    productionRestore: false,
  };
}
