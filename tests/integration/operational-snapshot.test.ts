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
  it('preserves read-only startup and finite deadlines against DSN overrides, then recovers after cancellation', async () => {
    const overridden = new URL(url);
    overridden.searchParams.set('statement_timeout', '0');
    overridden.searchParams.set('query_timeout', '30000');
    overridden.searchParams.set('connect_timeout', '0');
    overridden.searchParams.set('connectionTimeoutMillis', '30000');
    overridden.searchParams.set(
      'options',
      '-c statement_timeout=0 -c default_transaction_read_only=off',
    );
    const bounded = createOperationalReader(overridden.href);
    let renamed = false;
    let viewCreated = false;
    try {
      // A successful observation also proves the reader's transaction_read_only
      // check passed, despite the conflicting startup option in the URL.
      expect((await bounded.read()).connectionLimit).toBeGreaterThan(0);
      // This file runs sequentially in an isolated test database. Only the
      // temporary view sleeps; application rows and constraints are preserved.
      await database.pool.query(
        'ALTER TABLE autograph_processing_jobs RENAME TO ops_snapshot_saved_jobs',
      );
      renamed = true;
      await database.pool.query(
        `CREATE VIEW autograph_processing_jobs AS SELECT
          'queued'::autograph_processing_job_status AS status,
          now() AS available_at, NULL::timestamptz AS claimed_at,
          NULL::timestamptz AS finished_at FROM pg_sleep(8)`,
      );
      viewCreated = true;
      const started = performance.now();
      await expect(bounded.read()).rejects.toMatchObject({ code: '57014' });
      expect(performance.now() - started).toBeLessThan(4500);
      await database.pool.query('DROP VIEW autograph_processing_jobs');
      viewCreated = false;
      await database.pool.query(
        'ALTER TABLE ops_snapshot_saved_jobs RENAME TO autograph_processing_jobs',
      );
      renamed = false;
      expect((await bounded.read()).connectionLimit).toBeGreaterThan(0);
    } finally {
      await bounded.close();
      if (viewCreated)
        await database.pool.query('DROP VIEW autograph_processing_jobs');
      if (renamed)
        await database.pool.query(
          'ALTER TABLE ops_snapshot_saved_jobs RENAME TO autograph_processing_jobs',
        );
    }
  });

  it('observes committed upload reservations and retired-key backlog without disclosing or changing evidence', async () => {
    await storage.bootstrapLocalBucket();
    const user = randomUUID();
    const autographs = [randomUUID(), randomUUID(), randomUUID()];
    const assets = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const keys = assets.map(() => `private-upload-ops/${randomUUID()}`);
    const retiredKeys = [randomUUID(), randomUUID()].map(
      (id) => `private-retired-ops/${id}`,
    );
    const baseline = await reader.read();
    const client = await database.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO users (id) VALUES ($1)', [user]);
      await client.query(
        `INSERT INTO autographs (id,user_id,source,status) VALUES
        ($1,$4,'canvas','upload_pending'), ($2,$4,'photo','upload_pending'),
        ($3,$4,'canvas','uploaded_unverified')`,
        [...autographs, user],
      );
      for (let i = 0; i < 3; i++) {
        await client.query(
          `INSERT INTO autograph_assets (id,autograph_id,role,status,storage_key,
            expected_content_type,expected_size_bytes,verified_size_bytes,uploaded_at,upload_expires_at,created_at)
          VALUES ($1,$2,'original',$3::autograph_asset_status,$4,'image/png',1,
            CASE WHEN $3::autograph_asset_status='uploaded' THEN 1 ELSE NULL END,
            CASE WHEN $3::autograph_asset_status='uploaded' THEN now() ELSE NULL END,
            now() + $5::integer * interval '1 second',now()-interval '20 minutes')`,
          [
            assets[i],
            autographs[i],
            i === 2 ? 'uploaded' : 'reserved',
            keys[i],
            i === 0 ? 600 : -600,
          ],
        );
      }
      await client.query(
        `INSERT INTO autograph_assets (id,autograph_id,role,status,storage_key,
          actual_content_type,verified_size_bytes,width,height,uploaded_at)
        VALUES ($1,$2,'cleaned','uploaded',$3,'image/png',1,1,1,now())`,
        [assets[3], autographs[2], keys[3]],
      );
      await client.query(
        `INSERT INTO original_upload_tombstones (storage_key,next_check_at)
        VALUES ($1,now()-interval '15 minutes'), ($2,now()+interval '15 minutes')`,
        retiredKeys,
      );
      const uncommitted = await reader.read();
      expect(uncommitted.originalUploadsReserved).toBe(
        baseline.originalUploadsReserved,
      );
      expect(uncommitted.retiredUploadKeys).toBe(baseline.retiredUploadKeys);
      await client.query('COMMIT');
      committed = true;
      const rows = async () => ({
        assets: (
          await database.pool.query(
            'SELECT * FROM autograph_assets WHERE id = ANY($1::uuid[]) ORDER BY id',
            [assets],
          )
        ).rows,
        tombstones: (
          await database.pool.query(
            'SELECT * FROM original_upload_tombstones WHERE storage_key = ANY($1::text[]) ORDER BY storage_key',
            [retiredKeys],
          )
        ).rows,
      });
      const before = await rows();
      const snapshot = await collectOperationalSnapshot({
        readDatabase: () => reader.read(),
        checkStorage: () => storage.checkConnection(AbortSignal.timeout(5000)),
      });
      expect(snapshot.database).toMatchObject({
        originalUploadsReserved: baseline.originalUploadsReserved + 2,
        originalUploadsExpired: baseline.originalUploadsExpired + 1,
        retiredUploadKeys: baseline.retiredUploadKeys + 2,
        retiredUploadKeysDue: baseline.retiredUploadKeysDue + 1,
      });
      expect(
        snapshot.database!.originalUploadsOldestExpiredSeconds,
      ).toBeGreaterThanOrEqual(600);
      expect(
        snapshot.database!.retiredUploadOldestDueSeconds,
      ).toBeGreaterThanOrEqual(900);
      expect(snapshot.storageReachable).toBe(true);
      expect(await rows()).toEqual(before);
      const serialized = JSON.stringify(snapshot);
      for (const value of [
        user,
        ...autographs,
        ...assets,
        ...keys,
        ...retiredKeys,
        url,
        endpoint,
        bucket,
        accessKeyId,
        secretAccessKey,
      ])
        expect(serialized).not.toContain(value);
      expect(
        Object.values(snapshot.database!).every(
          (value) => Number.isSafeInteger(value) && value >= 0,
        ),
      ).toBe(true);
    } finally {
      if (!committed) await client.query('ROLLBACK');
      client.release();
      if (committed) {
        await database.pool.query(
          'DELETE FROM original_upload_tombstones WHERE storage_key = ANY($1::text[])',
          [retiredKeys],
        );
        await database.pool.query(
          'DELETE FROM autograph_assets WHERE id = ANY($1::uuid[])',
          [assets],
        );
        await database.pool.query(
          'DELETE FROM autographs WHERE id = ANY($1::uuid[])',
          [autographs],
        );
        await database.pool.query('DELETE FROM users WHERE id=$1', [user]);
      }
    }
  });

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
