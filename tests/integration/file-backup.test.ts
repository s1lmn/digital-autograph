import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import {
  backupPrivateFiles,
  verifyPrivateFileBackup,
  restoreFilesToLoopback,
  S3Client,
} from '../../packages/integrations/src/file-backup';
import {
  CreateBucketCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteBucketCommand,
  GetObjectCommand,
} from '../../packages/integrations/src/file-backup';
const endpoint = process.env.S3_ENDPOINT!;
if (!endpoint || new URL(endpoint).hostname !== '127.0.0.1')
  throw Error('Literal loopback MinIO required');
it('copies actual private bytes read-only, restores them into empty loopback storage, and rejects corrupted archives', async () => {
  const accessKeyId = process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey = process.env.S3_SECRET_ACCESS_KEY!;
  const client = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    maxAttempts: 1,
  });
  const source = 'destka-backup-' + randomUUID(),
    restore = 'destka-restore-' + randomUUID();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'destka-files-'));
  const archive = path.join(dir, 'archive');
  const keys = ['nested/private/original.png', 'autographs/cleaned.bin'];
  const bytes = [
    Buffer.from('synthetic private original'),
    Buffer.from([0, 255, 0, 128]),
  ];
  try {
    for (const Bucket of [source, restore])
      await client.send(new CreateBucketCommand({ Bucket }));
    for (let i = 0; i < 2; i++)
      await client.send(
        new PutObjectCommand({ Bucket: source, Key: keys[i], Body: bytes[i] }),
      );
    const backup = await backupPrivateFiles(
      client,
      source,
      archive,
      1024,
      endpoint,
    );
    expect(backup.objects).toBe(2);
    const result = await restoreFilesToLoopback({
      endpoint,
      accessKeyId,
      secretAccessKey,
      bucket: restore,
      directory: archive,
    });
    expect(result.filesRestorePassed).toBe(true);
    expect(result.filesManifestSha256).toBe(backup.manifestSha256);
    expect(
      (await fetch(endpoint + '/' + restore + '/autographs/cleaned.bin'))
        .status,
    ).toBe(403);
    for (let i = 0; i < 2; i++) {
      const r = await client.send(
        new GetObjectCommand({ Bucket: source, Key: keys[i] }),
      );
      expect(Buffer.from(await r.Body!.transformToByteArray())).toEqual(
        bytes[i],
      );
    }
    const proof = await verifyPrivateFileBackup(archive);
    await writeFile(
      path.join(archive, proof.manifest.objects[0]!.file),
      'corrupt',
    );
    await expect(verifyPrivateFileBackup(archive)).rejects.toThrow('integrity');
    await expect(
      restoreFilesToLoopback({
        endpoint: 'https://storage.yandexcloud.net',
        accessKeyId,
        secretAccessKey,
        bucket: restore,
        directory: archive,
      }),
    ).rejects.toThrow('loopback');
  } finally {
    for (const Bucket of [source, restore]) {
      for (const Key of keys)
        await client.send(new DeleteObjectCommand({ Bucket, Key }));
      await client.send(new DeleteBucketCommand({ Bucket }));
    }
    client.destroy();
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
