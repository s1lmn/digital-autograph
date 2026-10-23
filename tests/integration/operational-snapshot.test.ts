import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../packages/db/src/index';
import { createOperationalReader } from '../../packages/db/src/operational-snapshot';
import { createPrivateS3Storage } from '../../packages/integrations/src/private-s3';
import { collectOperationalSnapshot } from '../../apps/api/scripts/operational-snapshot';

const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/autograph_test')
  throw new Error('Use isolated autograph_test');
const endpoint = process.env.S3_ENDPOINT;
const bucket = process.env.S3_BUCKET;
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
if (!endpoint || !bucket || !accessKeyId || !secretAccessKey)
  throw new Error('Private MinIO test configuration required');
const database = createDatabase(url);
const reader = createOperationalReader(url);
const storage = createPrivateS3Storage({
  endpoint,
  bucket,
  region: process.env.S3_REGION ?? 'us-east-1',
  accessKeyId,
  secretAccessKey,
});
afterAll(async () => {
  storage.close();
  await reader.close();
  await database.close();
});

describe('real operator aggregates and private storage probe', () => {
  it('observes actual pending jobs without mutating them or exposing source data', async () => {
    await storage.bootstrapLocalBucket();
    const user = randomUUID(),
      autograph = randomUUID(),
      asset = randomUUID(),
      job = randomUUID();
    const privateKey = `private-ops-fixture/${randomUUID()}`;
    const baseline = await reader.read();
    await database.pool.query('INSERT INTO users (id) VALUES ($1)', [user]);
    try {
      await database.pool.query(
        "INSERT INTO autographs (id,user_id,source,status) VALUES ($1,$2,'canvas','uploaded_unverified')",
        [autograph, user],
      );
      await database.pool.query(
        `INSERT INTO autograph_assets (id,autograph_id,role,status,storage_key,
        expected_content_type,expected_size_bytes,verified_size_bytes,upload_expires_at,uploaded_at)
        VALUES ($1,$2,'original','uploaded',$3,'image/png',1,1,now()+interval '1 hour',now())`,
        [asset, autograph, privateKey],
      );
      await database.pool.query(
        `INSERT INTO autograph_processing_jobs (id,autograph_id,original_asset_id,available_at)
        VALUES ($1,$2,$3,now()-interval '10 minutes')`,
        [job, autograph, asset],
      );
      const before = await database.pool.query(
        'SELECT * FROM autograph_processing_jobs WHERE id=$1',
        [job],
      );
      const snapshot = await collectOperationalSnapshot({
        readDatabase: () => reader.read(),
        checkStorage: () => storage.checkConnection(AbortSignal.timeout(5000)),
      });
      expect(snapshot.database?.processingReady).toBe(
        baseline.processingReady + 1,
      );
      expect(
        snapshot.database?.processingOldestReadySeconds,
      ).toBeGreaterThanOrEqual(600);
      expect(snapshot.storageReachable).toBe(true);
      expect(snapshot.alerts).toContainEqual({
        code: 'PROCESSING_BACKLOG',
        severity: 'warning',
      });
      expect(
        (
          await database.pool.query(
            'SELECT * FROM autograph_processing_jobs WHERE id=$1',
            [job],
          )
        ).rows,
      ).toEqual(before.rows);
      const serialized = JSON.stringify(snapshot);
      for (const value of [
        user,
        autograph,
        asset,
        job,
        privateKey,
        url,
        endpoint,
        bucket,
        accessKeyId,
        secretAccessKey,
      ])
        expect(serialized).not.toContain(value);
    } finally {
      await database.pool.query(
        'DELETE FROM autograph_processing_jobs WHERE id=$1',
        [job],
      );
      await database.pool.query('DELETE FROM autograph_assets WHERE id=$1', [
        asset,
      ]);
      await database.pool.query('DELETE FROM autographs WHERE id=$1', [
        autograph,
      ]);
      await database.pool.query('DELETE FROM users WHERE id=$1', [user]);
    }
  });

  it('reports a missing bucket as unavailable rather than changing its policy or creating it', async () => {
    const absent = createPrivateS3Storage({
      endpoint,
      bucket: `absent-${randomUUID()}`,
      region: 'us-east-1',
      accessKeyId,
      secretAccessKey,
    });
    try {
      const snapshot = await collectOperationalSnapshot({
        readDatabase: () => reader.read(),
        checkStorage: () => absent.checkConnection(AbortSignal.timeout(5000)),
      });
      expect(snapshot.storageReachable).toBe(false);
      expect(snapshot.alerts).toContainEqual({
        code: 'STORAGE_UNAVAILABLE',
        severity: 'critical',
      });
    } finally {
      absent.close();
    }
  });
});
