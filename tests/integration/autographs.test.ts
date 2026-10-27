import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { SessionService } from '../../packages/auth/src/index';
import { AutographService } from '../../packages/autographs/src/index';
import {
  buildAcceptedApi as buildApi,
  acceptedSession,
} from './first-use-fixtures';
import {
  createDatabase,
  createPgAutographRepository,
  createPgAutographProcessingRepository,
  createPgSessionRepository,
  createPgWallRepository,
} from '../../packages/db/src/index';
import {
  creators,
  creatorProfiles,
  placements,
  slots,
  users,
  walls,
} from '../../packages/db/src/schema';
import { createPrivateS3Storage } from '../../packages/integrations/src/index';
import { WallService } from '../../packages/walls/src/index';
import { userFixture } from './fixtures';

const dbUrl = process.env.TEST_DATABASE_URL;
const s3Endpoint = process.env.S3_ENDPOINT;
const s3Bucket = process.env.S3_BUCKET;
const s3AccessKey = process.env.S3_ACCESS_KEY_ID;
const s3SecretKey = process.env.S3_SECRET_ACCESS_KEY;
if (!dbUrl || new URL(dbUrl).pathname !== '/autograph_test') {
  throw new Error(
    'Autograph integration tests require the isolated autograph_test database',
  );
}
if (!s3Endpoint || !s3Bucket || !s3AccessKey || !s3SecretKey) {
  throw new Error(
    'Autograph integration tests require private test S3 configuration',
  );
}

const database = createDatabase(dbUrl);
const storage = createPrivateS3Storage({
  endpoint: s3Endpoint,
  region: process.env.S3_REGION ?? 'us-east-1',
  bucket: s3Bucket,
  accessKeyId: s3AccessKey,
  secretAccessKey: s3SecretKey,
});
const sessions = new SessionService(
  createPgSessionRepository(database.pool),
  1209600,
);
const autographs = new AutographService(
  createPgAutographRepository(database.pool),
  storage,
  300,
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
  new WallService(createPgWallRepository(database.pool)),
  autographs,
);
const objectKeys: string[] = [];

async function usersAndTokens() {
  const [owner] = await database.db
    .insert(users)
    .values(userFixture(1))
    .returning();
  const [other] = await database.db
    .insert(users)
    .values(userFixture(2))
    .returning();
  if (!owner || !other) throw new Error('Expected users');
  return {
    owner,
    other,
    ownerToken: (await acceptedSession(sessions, database, owner.id)).token,
    otherToken: (await acceptedSession(sessions, database, other.id)).token,
  };
}

function headers(token?: string) {
  return token
    ? { cookie: `da_session=${token}`, origin: 'http://127.0.0.1:3000' }
    : {};
}

async function create(
  token: string,
  payload: Record<string, unknown> = { source: 'photo' },
) {
  return app.inject({
    method: 'POST',
    url: '/autographs',
    headers: headers(token),
    payload,
  });
}

async function initiate(
  id: string,
  token: string,
  payload: Record<string, unknown> = { contentType: 'image/png', sizeBytes: 4 },
) {
  return app.inject({
    method: 'POST',
    url: `/autographs/${id}/upload`,
    headers: headers(token),
    payload,
  });
}

async function complete(id: string, token: string) {
  return app.inject({
    method: 'POST',
    url: `/autographs/${id}/upload/complete`,
    headers: headers(token),
    payload: {},
  });
}

async function originalKey(assetId: string): Promise<string> {
  const result = await database.pool.query<{ storage_key: string }>(
    'SELECT storage_key FROM autograph_assets WHERE id = $1::uuid',
    [assetId],
  );
  const key = result.rows[0]?.storage_key;
  if (!key) throw new Error('Expected storage key');
  objectKeys.push(key);
  return key;
}

describe('Autograph private upload with PostgreSQL and MinIO', () => {
  beforeAll(async () => {
    await app.listen({ host: '127.0.0.1', port: 0 });
    await database.checkConnection();
    await storage.bootstrapLocalBucket();
  });
  beforeEach(async () =>
    database.pool.query(
      'TRUNCATE TABLE users, original_upload_tombstones CASCADE',
    ),
  );
  afterAll(async () => {
    await Promise.all(objectKeys.map((key) => storage.deleteObject(key)));
    await app.close();
    await database.close();
    storage.close();
  });

  it('creates owner-scoped metadata and rejects invalid or forged input', async () => {
    const { owner, ownerToken, otherToken } = await usersAndTokens();
    expect((await create('')).statusCode).toBe(401);
    expect((await create(ownerToken, { source: 'svg' })).statusCode).toBe(400);
    expect(
      (await create(ownerToken, { source: 'photo', userId: owner.id }))
        .statusCode,
    ).toBe(400);
    const result = await create(ownerToken, { source: 'canvas' });
    expect(result.statusCode).toBe(201);
    expect(result.json()).toMatchObject({
      source: 'canvas',
      status: 'draft',
      original: null,
    });
    const id = result.json().id as string;
    expect(
      (
        await app.inject({
          url: `/autographs/${id}`,
          headers: headers(ownerToken),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          url: `/autographs/${id}`,
          headers: headers(otherToken),
        })
      ).statusCode,
    ).toBe(403);
    expect((await app.inject(`/autographs/${id}`)).statusCode).toBe(401);
    expect(result.body).not.toContain(owner.id);
  });

  async function put(
    url: string,
    token: string,
    bytes: Buffer,
    contentType = 'image/png',
  ) {
    return app.inject({
      method: 'PUT',
      url,
      headers: { ...headers(token), 'content-type': contentType },
      payload: bytes,
    });
  }

  it('bounds the authenticated upload, preserves private reads and conditional writes, and completes idempotently', async () => {
    const { owner, ownerToken, otherToken } = await usersAndTokens();
    const id = (await create(ownerToken)).json().id as string;
    expect((await initiate(id, otherToken)).statusCode).toBe(403);
    expect((await complete(id, otherToken)).statusCode).toBe(403);
    for (const payload of [
      { contentType: 'image/svg+xml', sizeBytes: 4 },
      { contentType: 'image/png', sizeBytes: 10485761 },
    ])
      expect((await initiate(id, ownerToken, payload)).statusCode).toBe(400);
    const upload = (await initiate(id, ownerToken)).json();
    expect(upload).toMatchObject({
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
    });
    expect(upload.url).toBe(`/autographs/${id}/upload/${upload.assetId}`);
    expect(JSON.stringify(upload)).not.toContain(s3SecretKey);
    expect(JSON.stringify(upload)).not.toContain(owner.id);
    const key = await originalKey(upload.assetId);
    expect(key).toBe(`autographs/${id}/original/${upload.assetId}`);
    expect((await put(upload.url, '', Buffer.from('test'))).statusCode).toBe(
      401,
    );
    expect(
      (await put(upload.url, otherToken, Buffer.from('test'))).statusCode,
    ).toBe(403);
    expect((await complete(id, ownerToken)).statusCode).toBe(404);
    expect(
      (await put(upload.url, ownerToken, Buffer.from('test'), 'image/jpeg'))
        .statusCode,
    ).toBe(400);
    expect(
      (await put(upload.url, ownerToken, Buffer.from('test'))).statusCode,
    ).toBe(204);
    expect((await fetch(`${s3Endpoint}/${s3Bucket}/${key}`)).status).toBe(403);
    expect(await storage.statObject(key)).toEqual({
      sizeBytes: 4,
      contentType: 'image/png',
    });
    expect(
      (await put(upload.url, ownerToken, Buffer.from('new!'))).statusCode,
    ).toBe(412);
    expect(await storage.getPrivateObject(key, 4)).toEqual(Buffer.from('test'));
    const completed = await Promise.all([
      complete(id, ownerToken),
      complete(id, ownerToken),
    ]);
    expect(completed.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(completed[0]!.json()).toMatchObject({
      status: 'uploaded_unverified',
      original: { status: 'uploaded', verifiedSizeBytes: 4 },
    });
    expect(completed[0]!.body).not.toContain(key);
    expect((await initiate(id, ownerToken)).statusCode).toBe(409);
  });

  it('expires reservations without renewal and rejects foreign or forged asset keys', async () => {
    const { ownerToken } = await usersAndTokens();
    const id = (await create(ownerToken)).json().id as string;
    const first = (await initiate(id, ownerToken)).json();
    const second = (await initiate(id, ownerToken)).json();
    expect(second.expiresAt).toBe(first.expiresAt);
    const key = await originalKey(first.assetId);
    await database.pool.query(
      "UPDATE autograph_assets SET created_at = now() - interval '2 hours', upload_expires_at = now() - interval '1 hour' WHERE id = $1",
      [first.assetId],
    );
    expect(
      (await put(first.url, ownerToken, Buffer.from('late'))).statusCode,
    ).toBe(410);
    expect((await initiate(id, ownerToken)).statusCode).toBe(410);
    expect(await storage.statObject(key)).toBeNull();
    expect(
      (
        await put(
          `/autographs/${id}/upload/not-a-uuid`,
          ownerToken,
          Buffer.from('late'),
        )
      ).statusCode,
    ).toBe(400);
    expect(
      await createPgAutographProcessingRepository(
        database.pool,
      ).cleanupAbandoned(60, (key) => storage.deleteObject(key)),
    ).toBe(true);
    expect((await initiate(id, ownerToken)).json().assetId).not.toBe(
      first.assetId,
    );
    expect(
      (await put(first.url, ownerToken, Buffer.from('late'))).statusCode,
    ).toBe(410);
  });

  it('serializes repeated initiation into one original asset', async () => {
    const { ownerToken } = await usersAndTokens();
    const id = (await create(ownerToken)).json().id as string;
    const results = await Promise.all([
      initiate(id, ownerToken),
      initiate(id, ownerToken),
    ]);
    expect(results.map((result) => result.statusCode)).toEqual([200, 200]);
    expect(results[0]?.json().assetId).toBe(results[1]?.json().assetId);
    const assetId = results[0]?.json().assetId as string;
    await originalKey(assetId);
    const count = await database.pool.query<{ count: string }>(
      'SELECT count(*) FROM autograph_assets WHERE autograph_id = $1::uuid',
      [id],
    );
    expect(count.rows[0]?.count).toBe('1');
    expect(
      (
        await initiate(id, ownerToken, {
          contentType: 'image/jpeg',
          sizeBytes: 4,
        })
      ).statusCode,
    ).toBe(409);
  });

  it('rejects oversized real chunked HTTP bodies before S3 persistence, regardless of declared size', async () => {
    const { ownerToken } = await usersAndTokens();
    const id = (await create(ownerToken)).json().id as string;
    const upload = (await initiate(id, ownerToken)).json();
    const key = await originalKey(upload.assetId);
    const address = app.server.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected TCP listener');
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: address.port,
          path: upload.url,
          method: 'PUT',
          headers: {
            ...headers(ownerToken),
            'Content-Type': 'image/png',
            'Transfer-Encoding': 'chunked',
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode!));
        },
      );
      req.on('error', reject);
      for (let i = 0; i < 161; i++) req.write(Buffer.alloc(65536));
      req.end();
    });
    expect(status).toBe(413);
    expect(await storage.statObject(key)).toBeNull();
    expect(
      (
        await app.inject({
          url: `/autographs/${id}`,
          headers: headers(ownerToken),
        })
      ).json().status,
    ).toBe('upload_pending');
  });

  it('accepts the exact 10 MiB limit, rejects size mismatch, and caps retries durably', async () => {
    const { ownerToken } = await usersAndTokens();
    const id = (await create(ownerToken)).json().id as string;
    const upload = (
      await initiate(id, ownerToken, {
        contentType: 'image/png',
        sizeBytes: 10485760,
      })
    ).json();
    const key = await originalKey(upload.assetId);
    expect(
      (await put(upload.url, ownerToken, Buffer.alloc(10485760))).statusCode,
    ).toBe(204);
    expect((await storage.statObject(key))?.sizeBytes).toBe(10485760);
    const otherId = (await create(ownerToken)).json().id as string;
    const other = (await initiate(otherId, ownerToken)).json();
    const otherKey = await originalKey(other.assetId);
    for (let i = 0; i < 5; i++) {
      expect(
        (await put(other.url, ownerToken, Buffer.from('five!'))).json(),
      ).toEqual({ error: { code: 'UPLOAD_METADATA_MISMATCH' } });
      expect(await storage.statObject(otherKey)).toBeNull();
    }
    expect(
      (await put(other.url, ownerToken, Buffer.from('test'))).statusCode,
    ).toBe(410);
    expect((await initiate(otherId, ownerToken)).json().assetId).toBe(
      other.assetId,
    );
  });

  it('enforces concurrent account draft and pending quotas in PostgreSQL across repository instances', async () => {
    const { owner } = await usersAndTokens();
    const repo = createPgAutographRepository(database.pool);
    const otherRepo = createPgAutographRepository(database.pool);
    const drafts = await Promise.allSettled(
      Array.from({ length: 30 }, (_, i) =>
        (i % 2 ? repo : otherRepo).create(owner.id, 'photo'),
      ),
    );
    expect(drafts.filter((r) => r.status === 'fulfilled')).toHaveLength(20);
    expect(
      drafts
        .filter((r) => r.status === 'rejected')
        .every(
          (r) =>
            r.status === 'rejected' &&
            r.reason.code === 'UPLOAD_QUOTA_EXCEEDED',
        ),
    ).toBe(true);
    const ids = drafts.flatMap((r) =>
      r.status === 'fulfilled' ? [r.value.id] : [],
    );
    const reservations = await Promise.allSettled(
      ids.map((id) =>
        autographs.initiateUpload(owner.id, id, {
          contentType: 'image/png',
          sizeBytes: 10485760,
        }),
      ),
    );
    expect(reservations.filter((r) => r.status === 'fulfilled')).toHaveLength(
      3,
    );
    const count = await database.pool.query(
      "SELECT count(*) AS count, sum(expected_size_bytes) AS bytes FROM autograph_assets WHERE status = 'reserved'",
    );
    expect(count.rows[0]).toEqual({ count: '3', bytes: '31457280' });
    for (const r of reservations)
      if (r.status === 'fulfilled') await originalKey(r.value.assetId);
  });

  it('enforces total account and global creation budgets even when existing drafts are old', async () => {
    const { owner, other } = await usersAndTokens();
    await database.pool.query(
      "INSERT INTO autographs(user_id, source, created_at) SELECT $1::uuid, 'photo', now() - interval '2 hours' FROM generate_series(1,100)",
      [owner.id],
    );
    const repo = createPgAutographRepository(database.pool);
    await expect(repo.create(owner.id, 'photo')).rejects.toMatchObject({
      code: 'UPLOAD_QUOTA_EXCEEDED',
    });
    await database.pool.query(
      "INSERT INTO autographs(user_id, source) SELECT $1::uuid, 'photo' FROM generate_series(1,1999)",
      [owner.id],
    );
    const results = await Promise.allSettled([
      repo.create(other.id, 'photo'),
      repo.create(other.id, 'canvas'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('keeps expired reservations charged until cleanup succeeds, including the global pending budget', async () => {
    const { owner, other, ownerToken } = await usersAndTokens();
    const repo = createPgAutographRepository(database.pool);
    await database.pool.query(
      "INSERT INTO autographs(user_id, source, status) SELECT $1::uuid, 'photo', 'upload_pending' FROM generate_series(1,300)",
      [other.id],
    );
    await database.pool.query(
      `INSERT INTO autograph_assets(autograph_id, role, status, storage_key, expected_content_type, expected_size_bytes, created_at, upload_expires_at)
      SELECT id, 'original', 'reserved', 'synthetic/' || id, 'image/png', 10485760, now() - interval '2 hours', now() - interval '1 hour'
      FROM autographs WHERE user_id = $1::uuid`,
      [other.id],
    );
    const draft = await repo.create(owner.id, 'photo');
    await expect(
      autographs.initiateUpload(owner.id, draft.id, {
        contentType: 'image/png',
        sizeBytes: 4,
      }),
    ).rejects.toMatchObject({ code: 'UPLOAD_QUOTA_EXCEEDED' });
    const cleanup = createPgAutographProcessingRepository(database.pool);
    await expect(
      cleanup.cleanupAbandoned(60, async () => {
        throw new Error('synthetic unavailable');
      }),
    ).rejects.toThrow('synthetic unavailable');
    expect((await initiate(draft.id, ownerToken)).statusCode).toBe(429);
    expect(
      await cleanup.cleanupAbandoned(60, (key) => storage.deleteObject(key)),
    ).toBe(true);
    expect((await initiate(draft.id, ownerToken)).statusCode).toBe(200);
    const asset = (await initiate(draft.id, ownerToken)).json();
    await originalKey(asset.assetId);
  });

  it('bounds actual concurrent I/O across repository pools and releases permits after completion', async () => {
    const otherDatabase = createDatabase(dbUrl!);
    const otherService = new AutographService(
      createPgAutographRepository(otherDatabase.pool),
      storage,
      300,
    );
    const fixtures = [];
    for (let i = 0; i < 5; i++) {
      const user = userFixture(i + 10);
      await database.db.insert(users).values(user);
      const draft = await autographs.create(user.id!, 'photo');
      const upload = await autographs.initiateUpload(user.id!, draft.id, {
        contentType: 'image/png',
        sizeBytes: 4,
      });
      await originalKey(upload.assetId);
      fixtures.push({
        userId: user.id!,
        autographId: draft.id,
        assetId: upload.assetId,
      });
    }
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered: Promise<void>[] = [];
    const uploads = fixtures.slice(0, 4).map((f, i) => {
      let signalEntry!: () => void;
      entered.push(
        new Promise((resolve) => {
          signalEntry = resolve;
        }),
      );
      return (i % 2 ? autographs : otherService).uploadOriginal(
        f.userId,
        f.autographId,
        f.assetId,
        'image/png',
        async () => {
          signalEntry();
          await gate;
          return Buffer.from('test');
        },
        new AbortController().signal,
      );
    });
    try {
      await Promise.all(entered);
      const fifth = fixtures[4]!;
      await expect(
        otherService.uploadOriginal(
          fifth.userId,
          fifth.autographId,
          fifth.assetId,
          'image/png',
          async () => Buffer.from('test'),
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ code: 'UPLOAD_BUSY' });
    } finally {
      release();
      await Promise.all(uploads);
      await otherDatabase.close();
    }
    const fifth = fixtures[4]!;
    await expect(
      autographs.uploadOriginal(
        fifth.userId,
        fifth.autographId,
        fifth.assetId,
        'image/png',
        async () => Buffer.from('test'),
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();
  });

  it('recovers a successful S3 write with an unknown response without overwrite or a duplicate job', async () => {
    const { owner } = await usersAndTokens();
    const repo = createPgAutographRepository(database.pool);
    const uncertain = new AutographService(
      repo,
      {
        ...storage,
        putOriginal: async (input) => {
          await storage.putOriginal(input);
          throw new Error('synthetic response lost');
        },
      },
      300,
    );
    const draft = await uncertain.create(owner.id, 'photo');
    const upload = await uncertain.initiateUpload(owner.id, draft.id, {
      contentType: 'image/png',
      sizeBytes: 4,
    });
    const key = await originalKey(upload.assetId);
    await expect(
      uncertain.uploadOriginal(
        owner.id,
        draft.id,
        upload.assetId,
        'image/png',
        async () => Buffer.from('test'),
        new AbortController().signal,
      ),
    ).rejects.toThrow('synthetic response lost');
    expect((await autographs.get(owner.id, draft.id)).status).toBe(
      'upload_pending',
    );
    await expect(
      autographs.uploadOriginal(
        owner.id,
        draft.id,
        upload.assetId,
        'image/png',
        async () => Buffer.from('new!'),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'UPLOAD_ALREADY_EXISTS' });
    expect(await storage.getPrivateObject(key, 4)).toEqual(Buffer.from('test'));
    await autographs.completeUpload(owner.id, draft.id);
    await autographs.completeUpload(owner.id, draft.id);
    expect(
      (
        await database.pool.query(
          'SELECT count(*) FROM autograph_processing_jobs WHERE autograph_id = $1',
          [draft.id],
        )
      ).rows[0].count,
    ).toBe('1');
  });

  it('cancels an incomplete HTTP stream without creating an object and allows a bounded retry', async () => {
    const { ownerToken } = await usersAndTokens();
    const id = (await create(ownerToken)).json().id as string;
    const upload = (await initiate(id, ownerToken)).json();
    const key = await originalKey(upload.assetId);
    const address = app.server.address();
    if (!address || typeof address === 'string')
      throw new Error('TCP listener required');
    const req = httpRequest({
      host: '127.0.0.1',
      port: address.port,
      path: upload.url,
      method: 'PUT',
      headers: {
        ...headers(ownerToken),
        'Content-Type': 'image/png',
        'Transfer-Encoding': 'chunked',
      },
    });
    req.on('error', () => {});
    req.write('te');
    try {
      let attempts = 0;
      for (let i = 0; i < 100; i++) {
        attempts = (
          await database.pool.query(
            'SELECT upload_attempts FROM autograph_assets WHERE id = $1',
            [upload.assetId],
          )
        ).rows[0].upload_attempts;
        if (attempts === 1) break;
        await delay(10);
      }
      expect(attempts).toBe(1);
    } finally {
      req.destroy();
    }
    // A new request serializes with rollback of the aborted stream transaction.
    expect(
      (await put(upload.url, ownerToken, Buffer.from('test'))).statusCode,
    ).toBe(204);
    expect(await storage.getPrivateObject(key, 4)).toEqual(Buffer.from('test'));
  });

  it('tracks retired keys after reservation cleanup and reaps late orphan objects without touching a fresh upload', async () => {
    const { owner } = await usersAndTokens();
    const draft = await autographs.create(owner.id, 'photo');
    const upload = await autographs.initiateUpload(owner.id, draft.id, {
      contentType: 'image/png',
      sizeBytes: 4,
    });
    const key = await originalKey(upload.assetId);
    await database.pool.query(
      "UPDATE autograph_assets SET created_at = now() - interval '2 hours', upload_expires_at = now() - interval '1 hour' WHERE id = $1",
      [upload.assetId],
    );
    const cleanup = createPgAutographProcessingRepository(database.pool);
    expect(
      await cleanup.cleanupAbandoned(60, (key) => storage.deleteObject(key)),
    ).toBe(true);
    expect(
      (
        await database.pool.query(
          'SELECT storage_key FROM original_upload_tombstones',
        )
      ).rows,
    ).toEqual([{ storage_key: key }]);
    const fresh = await autographs.initiateUpload(owner.id, draft.id, {
      contentType: 'image/png',
      sizeBytes: 4,
    });
    const freshKey = await originalKey(fresh.assetId);
    await autographs.uploadOriginal(
      owner.id,
      draft.id,
      fresh.assetId,
      'image/png',
      async () => Buffer.from('new!'),
      new AbortController().signal,
    );
    // Synthetic late provider commit after an earlier request was aborted.
    await storage.putPrivateObject(key, Buffer.from('late'));
    await database.pool.query(
      'UPDATE original_upload_tombstones SET next_check_at = now()',
    );
    expect(
      await cleanup.cleanupAbandoned(60, (key) => storage.deleteObject(key)),
    ).toBe(true);
    expect(await storage.statObject(key)).toBeNull();
    expect(await storage.getPrivateObject(freshKey, 4)).toEqual(
      Buffer.from('new!'),
    );
    expect(
      (
        await database.pool.query(
          'SELECT count(*) FROM original_upload_tombstones',
        )
      ).rows[0].count,
    ).toBe('1');
  });

  it('rejects concurrent rewrites through real S3 conditional writes and expires private read signatures', async () => {
    const { ownerToken } = await usersAndTokens();
    const id = (await create(ownerToken)).json().id as string;
    const upload = (await initiate(id, ownerToken)).json();
    const key = await originalKey(upload.assetId);
    const results = await Promise.all([
      put(upload.url, ownerToken, Buffer.from('one!')),
      put(upload.url, ownerToken, Buffer.from('two!')),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([204, 412]);
    const winner = results[0]!.statusCode === 204 ? 'one!' : 'two!';
    expect(await storage.getPrivateObject(key, 4)).toEqual(Buffer.from(winner));
    const signedRead = await storage.signPrivateRead(key, 1);
    expect((await fetch(signedRead)).status).toBe(200);
    await delay(2200);
    expect((await fetch(signedRead)).status).toBe(403);
    expect((await fetch(`${s3Endpoint}/${s3Bucket}/${key}`)).status).toBe(403);
  });

  it('caps durable retired-key bookkeeping instead of growing an unbounded orphan queue', async () => {
    const { owner } = await usersAndTokens();
    await database.pool.query(
      "INSERT INTO original_upload_tombstones(storage_key) SELECT 'synthetic-retired/' || i FROM generate_series(1,9999) AS i",
    );
    const first = await autographs.create(owner.id, 'photo');
    const second = await autographs.create(owner.id, 'photo');
    const results = await Promise.allSettled(
      [first, second].map((draft) =>
        autographs.initiateUpload(owner.id, draft.id, {
          contentType: 'image/png',
          sizeBytes: 4,
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    for (const r of results)
      if (r.status === 'fulfilled') await originalKey(r.value.assetId);
  });

  it('applies the original-object account cap to legacy drafts without deleting existing originals', async () => {
    const { owner } = await usersAndTokens();
    await database.pool.query(
      "INSERT INTO autographs(user_id, source, created_at) SELECT $1::uuid, 'photo', now() - interval '2 hours' FROM generate_series(1,101)",
      [owner.id],
    );
    await database.pool.query(
      `INSERT INTO autograph_assets(autograph_id, role, status, storage_key, expected_content_type, expected_size_bytes, verified_size_bytes, uploaded_at, upload_expires_at)
      SELECT id, 'original', 'uploaded', 'synthetic-legacy/' || id, 'image/png', 4, 4, now(), now() + interval '5 minutes'
      FROM autographs WHERE user_id = $1::uuid ORDER BY id LIMIT 100`,
      [owner.id],
    );
    const target = (
      await database.pool.query(
        'SELECT id FROM autographs WHERE user_id = $1 AND NOT EXISTS (SELECT 1 FROM autograph_assets aa WHERE aa.autograph_id = autographs.id)',
        [owner.id],
      )
    ).rows[0].id;
    await expect(
      autographs.initiateUpload(owner.id, target, {
        contentType: 'image/png',
        sizeBytes: 4,
      }),
    ).rejects.toMatchObject({ code: 'UPLOAD_QUOTA_EXCEEDED' });
    expect(
      (
        await database.pool.query(
          "SELECT count(*) FROM autograph_assets WHERE status = 'uploaded'",
        )
      ).rows[0].count,
    ).toBe('100');
  });

  it('does not expose an original through public Wall or Creator reads', async () => {
    const { owner, ownerToken } = await usersAndTokens();
    const autographId = (await create(ownerToken)).json().id as string;
    const upload = (await initiate(autographId, ownerToken)).json() as {
      assetId: string;
    };
    const key = await originalKey(upload.assetId);
    const [creator] = await database.db
      .insert(creators)
      .values({ ownerUserId: owner.id })
      .returning();
    if (!creator) throw new Error('Expected creator');
    await database.db.insert(creatorProfiles).values({
      creatorId: creator.id,
      slug: 'private-test',
      displayName: 'Private Test',
    });
    const [wall] = await database.db
      .insert(walls)
      .values({ creatorId: creator.id, status: 'live', slotCount: 1 })
      .returning();
    if (!wall) throw new Error('Expected wall');
    const [slot] = await database.db
      .insert(slots)
      .values({ wallId: wall.id, position: 0 })
      .returning();
    if (!slot) throw new Error('Expected slot');
    await database.db.insert(placements).values({
      slotId: slot.id,
      userId: owner.id,
      source: 'admin',
      autographId,
    });
    const publicWall = await app.inject(`/walls/${wall.id}`);
    const publicCreator = await app.inject('/creators/private-test');
    expect(publicWall.statusCode).toBe(200);
    expect(publicCreator.statusCode).toBe(200);
    expect(publicWall.body + publicCreator.body).not.toContain(key);
    expect(publicWall.body + publicCreator.body).not.toContain(autographId);
    expect(publicWall.body + publicCreator.body).not.toContain(upload.assetId);
  });
});
