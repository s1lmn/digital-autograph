import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { SessionService } from '../../packages/auth/src/index';
import {
  AutographService,
  PrivateObjectTooLargeError,
} from '../../packages/autographs/src/index';
import { buildApi } from '../../apps/api/src/app';
import {
  processOneAutographJob,
  type WorkerOperations,
} from '../../apps/worker/src/worker';
import {
  createDatabase,
  createPgAutographProcessingRepository,
  createPgAutographRepository,
  createPgSessionRepository,
} from '../../packages/db/src/index';
import { users } from '../../packages/db/src/schema';
import { createPrivateS3Storage } from '../../packages/integrations/src/index';
import { userFixture } from './fixtures';

const dbUrl = process.env.TEST_DATABASE_URL;
if (!dbUrl || new URL(dbUrl).pathname !== '/autograph_test')
  throw new Error('Use isolated autograph_test database');
const s3Endpoint = process.env.S3_ENDPOINT;
const s3Bucket = process.env.S3_BUCKET;
const s3AccessKey = process.env.S3_ACCESS_KEY_ID;
const s3SecretKey = process.env.S3_SECRET_ACCESS_KEY;
if (!s3Endpoint || !s3Bucket || !s3AccessKey || !s3SecretKey)
  throw new Error('Private MinIO test configuration required');

const database = createDatabase(dbUrl);
const storage = createPrivateS3Storage({
  endpoint: s3Endpoint,
  bucket: s3Bucket,
  region: process.env.S3_REGION ?? 'us-east-1',
  accessKeyId: s3AccessKey,
  secretAccessKey: s3SecretKey,
});
const repo = createPgAutographRepository(database.pool);
const jobs = createPgAutographProcessingRepository(database.pool);
const service = new AutographService(repo, storage, 300);
const sessions = new SessionService(
  createPgSessionRepository(database.pool),
  1209600,
);
const app = buildApi(
  database,
  sessions,
  {
    appEnvironment: 'test',
    sessionTtlSeconds: 1209600,
    trustedWebOrigins: ['http://127.0.0.1:3000'],
  },
  undefined,
  undefined,
  undefined,
  service,
);
const keys: string[] = [];
const operations: WorkerOperations = {
  repository: jobs,
  storage,
  leaseSeconds: 300,
  pollIntervalMs: 1000,
  cleanupGraceSeconds: 600,
};

async function fixture(
  source: 'photo' | 'canvas' = 'photo',
  bytes?: Buffer,
  declared = 'image/png',
) {
  const userId = randomUUID();
  await database.db.insert(users).values({ ...userFixture(1), id: userId });
  const token = (await sessions.createSession(userId)).token;
  const draft = await service.create(userId, source);
  const input =
    bytes ??
    (await sharp({
      create: { width: 180, height: 110, channels: 3, background: '#ffffff' },
    })
      .composite([
        {
          input: {
            create: {
              width: 100,
              height: 5,
              channels: 3,
              background: '#000000',
            },
          },
          left: 40,
          top: 50,
        },
      ])
      .png()
      .toBuffer());
  const upload = await service.initiateUpload(userId, draft.id, {
    contentType: declared as 'image/png',
    sizeBytes: input.length,
  });
  const originalKey = `autographs/${draft.id}/original/${upload.assetId}`;
  keys.push(originalKey);
  const response = await fetch(upload.url, {
    method: 'PUT',
    headers: upload.headers,
    body: new Uint8Array(input),
  });
  expect(response.status).toBe(200);
  return { userId, token, draft, upload, originalKey, input };
}

describe('PostgreSQL autograph jobs and real private MinIO', () => {
  beforeAll(async () => {
    await database.checkConnection();
    await storage.bootstrapLocalBucket();
  });
  beforeEach(async () => {
    await database.pool.query('TRUNCATE TABLE users CASCADE');
  });
  afterAll(async () => {
    await Promise.all(keys.map((key) => storage.deleteObject(key)));
    await app.close();
    await database.close();
    storage.close();
  });

  it('atomically enqueues once, processes privately, and gives only the owner a short preview', async () => {
    const f = await fixture();
    const [first, second] = await Promise.all([
      service.completeUpload(f.userId, f.draft.id),
      service.completeUpload(f.userId, f.draft.id),
    ]);
    expect(first.status).toBe('uploaded_unverified');
    expect(second.status).toBe('uploaded_unverified');
    const count = await database.pool.query<{ count: string }>(
      'SELECT count(*) FROM autograph_processing_jobs WHERE autograph_id = $1::uuid',
      [f.draft.id],
    );
    expect(count.rows[0]?.count).toBe('1');
    expect(await processOneAutographJob(operations)).toBe(true);
    expect(await processOneAutographJob(operations)).toBe(false);
    expect((await service.get(f.userId, f.draft.id)).status).toBe(
      'awaiting_approval',
    );
    const asset = await database.pool.query<{
      storage_key: string;
      verified_size_bytes: number;
      width: number;
      height: number;
    }>(
      "SELECT storage_key, verified_size_bytes, width, height FROM autograph_assets WHERE autograph_id = $1::uuid AND role = 'cleaned'",
      [f.draft.id],
    );
    const cleaned = asset.rows[0];
    expect(cleaned?.storage_key).toContain('/cleaned/');
    expect(cleaned?.verified_size_bytes).toBeGreaterThan(0);
    expect(cleaned?.width).toBeLessThanOrEqual(2048);
    if (!cleaned) throw new Error('Expected cleaned asset');
    keys.push(cleaned.storage_key);
    const unsigned = await fetch(
      `${s3Endpoint}/${s3Bucket}/${cleaned.storage_key}`,
    );
    expect(unsigned.status).toBeGreaterThanOrEqual(400);
    const preview = await app.inject({
      url: `/autographs/${f.draft.id}/preview`,
      headers: { cookie: `da_session=${f.token}` },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['cache-control']).toBe('no-store');
    expect(preview.body).not.toContain(f.originalKey);
    const url = preview.json().url as string;
    expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('120');
    expect((await fetch(url)).status).toBe(200);
    const stranger = randomUUID();
    await database.db.insert(users).values({ id: stranger });
    const strangerToken = (await sessions.createSession(stranger)).token;
    expect(
      (
        await app.inject({
          url: `/autographs/${f.draft.id}/preview`,
          headers: { cookie: `da_session=${strangerToken}` },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('fails invalid uploaded bytes without a cleaned asset', async () => {
    const f = await fixture('photo', Buffer.from('not actually a PNG'));
    await service.completeUpload(f.userId, f.draft.id);
    await processOneAutographJob(operations);
    expect((await service.get(f.userId, f.draft.id)).status).toBe(
      'processing_failed',
    );
    const job = await database.pool.query<{
      status: string;
      failure_code: string;
    }>(
      'SELECT status, failure_code FROM autograph_processing_jobs WHERE autograph_id = $1::uuid',
      [f.draft.id],
    );
    expect(job.rows[0]).toMatchObject({
      status: 'failed',
      failure_code: 'INVALID_IMAGE',
    });
    expect(
      (
        await database.pool.query(
          "SELECT id FROM autograph_assets WHERE autograph_id = $1::uuid AND role = 'cleaned'",
          [f.draft.id],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await app.inject({
          url: `/autographs/${f.draft.id}/preview`,
          headers: { cookie: `da_session=${f.token}` },
        })
      ).statusCode,
    ).toBe(409);
  });

  it('leases to one worker, recovers stale leases, and rejects a previous token', async () => {
    const f = await fixture();
    await service.completeUpload(f.userId, f.draft.id);
    const [one, two] = await Promise.all([jobs.claim(60), jobs.claim(60)]);
    expect([one, two].filter(Boolean)).toHaveLength(1);
    const first = one ?? two;
    if (!first) throw new Error('Expected job');
    await database.pool.query(
      "UPDATE autograph_processing_jobs SET claimed_at = now() - interval '2 minutes' WHERE id = $1::uuid",
      [first.id],
    );
    const recovered = await jobs.claim(60);
    expect(recovered?.id).toBe(first.id);
    expect(recovered?.leaseToken).not.toBe(first.leaseToken);
    expect(
      await jobs.succeed(
        first,
        { key: 'stale', sizeBytes: 1, width: 1, height: 1 },
        60,
      ),
    ).toBe(false);
    if (!recovered) throw new Error('Expected recovered job');
    expect(await jobs.fail(recovered, 'INVALID_IMAGE', true, 60)).toBe(true);
    expect((await service.get(f.userId, f.draft.id)).status).toBe(
      'processing_failed',
    );
  });

  it('makes a stale third claim terminal instead of leaving processing stuck', async () => {
    const f = await fixture();
    await service.completeUpload(f.userId, f.draft.id);
    const claim = await jobs.claim(60);
    if (!claim) throw new Error('Expected job');
    await database.pool.query(
      "UPDATE autograph_processing_jobs SET attempts = 3, claimed_at = now() - interval '2 minutes' WHERE id = $1::uuid",
      [claim.id],
    );
    expect(await jobs.claim(60)).toBeNull();
    const row = await database.pool.query<{
      status: string;
      failure_code: string;
    }>(
      'SELECT status, failure_code FROM autograph_processing_jobs WHERE id = $1::uuid',
      [claim.id],
    );
    expect(row.rows[0]).toMatchObject({
      status: 'failed',
      failure_code: 'PROCESSING_FAILURE',
    });
    expect((await service.get(f.userId, f.draft.id)).status).toBe(
      'processing_failed',
    );
  });

  it('retries transient storage failure with delay and stops after three attempts', async () => {
    const f = await fixture();
    await service.completeUpload(f.userId, f.draft.id);
    const unavailable = {
      ...storage,
      getPrivateObject: async () => {
        throw new Error('temporary storage outage');
      },
    };
    const failing = { ...operations, storage: unavailable };
    for (let attempt = 1; attempt <= 3; attempt++) {
      expect(await processOneAutographJob(failing)).toBe(true);
      const result = await database.pool.query<{
        status: string;
        attempts: number;
        failure_code: string;
        available_at: Date;
      }>(
        'SELECT status, attempts, failure_code, available_at FROM autograph_processing_jobs WHERE autograph_id = $1::uuid',
        [f.draft.id],
      );
      expect(result.rows[0]?.attempts).toBe(attempt);
      expect(result.rows[0]?.failure_code).toBe('STORAGE_FAILURE');
      if (attempt < 3) {
        expect(result.rows[0]?.status).toBe('queued');
        expect(result.rows[0]?.available_at.getTime()).toBeGreaterThan(
          Date.now(),
        );
        await database.pool.query(
          "UPDATE autograph_processing_jobs SET available_at = now() - interval '1 second' WHERE autograph_id = $1::uuid",
          [f.draft.id],
        );
      } else {
        expect(result.rows[0]?.status).toBe('failed');
      }
    }
    expect((await service.get(f.userId, f.draft.id)).status).toBe(
      'processing_failed',
    );
    expect(await processOneAutographJob(operations)).toBe(false);
  });

  it('removes a partial cleaned object while holding its active lease', async () => {
    const f = await fixture();
    await service.completeUpload(f.userId, f.draft.id);
    const partialStorage = {
      ...storage,
      putPrivateObject: async (key: string, bytes: Buffer) => {
        await storage.putPrivateObject(key, bytes);
        throw new Error('lost response after PUT');
      },
    };
    await processOneAutographJob({ ...operations, storage: partialStorage });
    const row = await database.pool.query<{ id: string; status: string }>(
      'SELECT id, status FROM autograph_processing_jobs WHERE autograph_id = $1::uuid',
      [f.draft.id],
    );
    const job = row.rows[0];
    if (!job) throw new Error('Expected job');
    const key = `autographs/${f.draft.id}/cleaned/${job.id}.png`;
    keys.push(key);
    expect(job.status).toBe('queued');
    expect(await storage.statObject(key)).toBeNull();
    await database.pool.query(
      "UPDATE autograph_processing_jobs SET available_at = now() - interval '1 second' WHERE id = $1::uuid",
      [job.id],
    );
    await processOneAutographJob(operations);
    expect((await service.get(f.userId, f.draft.id)).status).toBe(
      'awaiting_approval',
    );
  });

  it('bounds stream reads even when object metadata is misleading', async () => {
    const key = `autographs/${randomUUID()}/original/${randomUUID()}`;
    keys.push(key);
    await storage.putPrivateObject(key, Buffer.alloc(10 * 1024 * 1024 + 1));
    await expect(
      storage.getPrivateObject(key, 10 * 1024 * 1024),
    ).rejects.toBeInstanceOf(PrivateObjectTooLargeError);
  });

  it('keeps a completed original when abandoned cleanup races with completion', async () => {
    const f = await fixture();
    await database.pool.query(
      "UPDATE autograph_assets SET created_at = now() - interval '2 hours', upload_expires_at = now() - interval '1 hour' WHERE id = $1::uuid",
      [f.upload.assetId],
    );
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const completing = repo.completeOriginal(f.userId, f.draft.id, async () => {
      entered?.();
      await gate;
      return f.input.length;
    });
    await inside;
    const cleaning = jobs.cleanupAbandoned(60, (key) =>
      storage.deleteObject(key),
    );
    release?.();
    expect((await completing).status).toBe('uploaded_unverified');
    expect(await cleaning).toBe(false);
    expect(await storage.statObject(f.originalKey)).not.toBeNull();
  });

  it('deletes expired reserved objects and returns their Autograph to draft', async () => {
    const f = await fixture();
    await database.pool.query(
      "UPDATE autograph_assets SET created_at = now() - interval '2 hours', upload_expires_at = now() - interval '1 hour' WHERE id = $1::uuid",
      [f.upload.assetId],
    );
    expect(
      await jobs.cleanupAbandoned(60, (key) => storage.deleteObject(key)),
    ).toBe(true);
    expect(await storage.statObject(f.originalKey)).toBeNull();
    expect((await service.get(f.userId, f.draft.id)).status).toBe('draft');
  });

  it('retains rejection and later cleans the reserved object if immediate deletion fails', async () => {
    const userId = randomUUID();
    await database.db.insert(users).values({ id: userId });
    const draft = await service.create(userId, 'photo');
    const upload = await service.initiateUpload(userId, draft.id, {
      contentType: 'image/png',
      sizeBytes: 4,
    });
    const key = `autographs/${draft.id}/original/${upload.assetId}`;
    keys.push(key);
    expect(
      (
        await fetch(upload.url, {
          method: 'PUT',
          headers: upload.headers,
          body: 'five!',
        })
      ).status,
    ).toBe(200);
    const failingStorage = {
      ...storage,
      deleteObject: async () => {
        throw new Error('storage unavailable');
      },
    };
    const failingService = new AutographService(repo, failingStorage, 300);
    await expect(
      failingService.completeUpload(userId, draft.id),
    ).rejects.toMatchObject({ code: 'UPLOAD_METADATA_MISMATCH' });
    expect((await service.get(userId, draft.id)).status).toBe('upload_pending');
    expect(await storage.statObject(key)).not.toBeNull();
    await database.pool.query(
      "UPDATE autograph_assets SET created_at = now() - interval '2 hours', upload_expires_at = now() - interval '1 hour' WHERE id = $1::uuid",
      [upload.assetId],
    );
    expect(
      await jobs.cleanupAbandoned(60, (objectKey) =>
        storage.deleteObject(objectKey),
      ),
    ).toBe(true);
    expect(await storage.statObject(key)).toBeNull();
  });
});
