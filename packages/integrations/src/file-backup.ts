import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const digest = (v: Uint8Array | string) =>
  createHash('sha256').update(v).digest('hex');
type Entry = {
  key: string;
  etag: string;
  size: number;
  modified: string;
  contentType?: string;
  contentDisposition?: string;
  cacheControl?: string;
  contentEncoding?: string;
  metadata?: Record<string, string>;
  file: string;
  sha256: string;
};
type Manifest = {
  version: 1;
  bucket: string;
  sourceEndpoint: string;
  objects: Entry[];
};
const options = () => ({ abortSignal: AbortSignal.timeout(30000) });
async function inventory(client: S3Client, bucket: string) {
  const rows: { key: string; etag: string; size: number; modified: string }[] =
    [];
  let token: string | undefined;
  do {
    const result = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
      options(),
    );
    for (const o of result.Contents ?? []) {
      if (
        typeof o.Key !== 'string' ||
        !o.ETag ||
        !Number.isSafeInteger(o.Size) ||
        !o.LastModified ||
        !Number.isFinite(o.LastModified.getTime()) ||
        o.Size! < 0
      )
        throw Error('Invalid private object inventory');
      rows.push({
        key: o.Key,
        etag: o.ETag,
        size: o.Size!,
        modified: o.LastModified!.toISOString(),
      });
      if (rows.length > 100000) throw Error('Backup object budget exceeded');
    }
    if (
      result.IsTruncated &&
      (!result.NextContinuationToken || result.NextContinuationToken === token)
    )
      throw Error('Invalid inventory pagination');
    token = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (token);
  return rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
// Read-only source: never writes, deletes, retags or changes policies in the source bucket.
export async function backupPrivateFiles(
  client: S3Client,
  bucket: string,
  directory: string,
  maxBytes: number,
  sourceEndpoint: string,
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw Error('Explicit backup byte budget required');
  await mkdir(directory, { mode: 0o700 }); // Refuse existing output; never replace evidence.
  const before = await inventory(client, bucket);
  if (before.reduce((n, o) => n + o.size, 0) > maxBytes)
    throw Error('Backup byte budget exceeded');
  const objects: Entry[] = [];
  for (const item of before) {
    const file = digest(item.key) + '.bin',
      target = await open(path.join(directory, file), 'wx', 0o600);
    const h = createHash('sha256');
    let size = 0;
    let headers: Pick<
      Entry,
      | 'contentType'
      | 'contentDisposition'
      | 'cacheControl'
      | 'contentEncoding'
      | 'metadata'
    > = {};
    try {
      const response = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: item.key,
          IfMatch: item.etag,
        }),
        options(),
      );
      if (!response.Body) throw Error('Missing object body');
      headers = {
        contentType: response.ContentType,
        contentDisposition: response.ContentDisposition,
        cacheControl: response.CacheControl,
        contentEncoding: response.ContentEncoding,
        metadata: response.Metadata,
      };
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        size += chunk.length;
        if (size > item.size) throw Error('Object changed during backup');
        h.update(chunk);
        await target.writeFile(chunk);
      }
      await target.sync();
    } finally {
      await target.close();
    }
    if (size !== item.size) throw Error('Incomplete file backup');
    objects.push({ ...item, ...headers, file, sha256: h.digest('hex') });
  }
  if (
    JSON.stringify(before) !== JSON.stringify(await inventory(client, bucket))
  )
    throw Error(
      'Source changed during backup; retain archive and repeat after drain',
    );
  const manifest: Manifest = {
    version: 1,
    bucket,
    sourceEndpoint: new URL(sourceEndpoint).origin,
    objects,
  };
  const bytes = Buffer.from(JSON.stringify(manifest) + '\n');
  await writeFile(path.join(directory, 'manifest.json'), bytes, {
    mode: 0o600,
    flag: 'wx',
  });
  return {
    manifestSha256: digest(bytes),
    objects: objects.length,
    bytes: objects.reduce((n, o) => n + o.size, 0),
  };
}
export async function verifyPrivateFileBackup(directory: string) {
  const bytes = await readFile(path.join(directory, 'manifest.json'));
  const m = JSON.parse(bytes.toString()) as Manifest;
  if (
    m.version !== 1 ||
    typeof m.sourceEndpoint !== 'string' ||
    !Array.isArray(m.objects)
  )
    throw Error('Invalid backup manifest');
  const names = new Set<string>();
  for (const o of m.objects) {
    if (
      typeof o.key !== 'string' ||
      o.file !== digest(o.key) + '.bin' ||
      !Number.isSafeInteger(o.size) ||
      o.size < 0 ||
      !/^[a-f0-9]{64}$/.test(o.sha256) ||
      names.has(o.file)
    )
      throw Error('Invalid backup entry');
    names.add(o.file);
    const file = path.join(directory, o.file),
      info = await stat(file);
    if (
      !info.isFile() ||
      info.size !== o.size ||
      digest(await readFile(file)) !== o.sha256
    )
      throw Error('Backup integrity failed');
  }
  return {
    manifest: m,
    manifestSha256: digest(bytes),
    objects: m.objects.length,
  };
}
// Real backup bytes may be rehearsed ONLY into an isolated loopback MinIO target.
export async function restoreFilesToLoopback(config: {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  directory: string;
}) {
  const u = new URL(config.endpoint);
  if (
    u.protocol !== 'http:' ||
    u.hostname !== '127.0.0.1' ||
    !u.port ||
    u.username ||
    u.password ||
    u.pathname !== '/' ||
    u.search ||
    u.hash ||
    !config.bucket.startsWith('destka-restore-')
  )
    throw Error('Fresh loopback restore target required');
  const client = new S3Client({
    endpoint: u.origin,
    region: 'us-east-1',
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  try {
    const proof = await verifyPrivateFileBackup(config.directory);
    if ((await inventory(client, config.bucket)).length !== 0)
      throw Error('Restore target must be empty');
    for (const o of proof.manifest.objects) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: o.key,
          Body: await readFile(path.join(config.directory, o.file)),
          ContentType: o.contentType,
          ContentDisposition: o.contentDisposition,
          CacheControl: o.cacheControl,
          ContentEncoding: o.contentEncoding,
          Metadata: o.metadata,
          IfNoneMatch: '*',
        }),
        options(),
      );
      const result = await client.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: o.key }),
        options(),
      );
      if (
        result.ContentType !== o.contentType ||
        JSON.stringify(result.Metadata ?? {}) !==
          JSON.stringify(o.metadata ?? {}) ||
        !result.Body ||
        digest(await result.Body.transformToByteArray()) !== o.sha256
      )
        throw Error('Restored object integrity failed');
    }
    return {
      filesManifestSha256: proof.manifestSha256,
      filesRestorePassed: true,
      objects: proof.objects,
    };
  } finally {
    client.destroy();
  }
}

export {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteBucketCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
