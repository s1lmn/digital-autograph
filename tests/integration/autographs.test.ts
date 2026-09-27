import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { SessionService } from '../../packages/auth/src/index';
import { AutographService } from '../../packages/autographs/src/index';
import { buildApi } from '../../apps/api/src/app';
import {
  createDatabase,
  createPgAutographRepository,
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
    ownerToken: (await sessions.createSession(owner.id)).token,
    otherToken: (await sessions.createSession(other.id)).token,
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
    await database.checkConnection();
    await storage.bootstrapLocalBucket();
  });
  beforeEach(async () => database.pool.query('TRUNCATE TABLE users CASCADE'));
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

  it('issues a private signed PUT, confirms HEAD, and never marks bytes ready', async () => {
    const { owner, ownerToken, otherToken } = await usersAndTokens();
    const id = (await create(ownerToken)).json().id as string;
    expect((await initiate(id, otherToken)).statusCode).toBe(403);
    expect((await complete(id, otherToken)).statusCode).toBe(403);
    expect(
      (
        await initiate(id, ownerToken, {
          contentType: 'image/svg+xml',
          sizeBytes: 4,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await initiate(id, ownerToken, {
          contentType: 'image/png',
          sizeBytes: 10 * 1024 * 1024 + 1,
        })
      ).statusCode,
    ).toBe(400);
    const started = await initiate(id, ownerToken);
    expect(started.statusCode).toBe(200);
    const upload = started.json() as {
      assetId: string;
      url: string;
      headers: Record<string, string>;
      method: string;
    };
    expect(upload.method).toBe('PUT');
    expect(upload.url).not.toContain(s3SecretKey);
    expect(upload.url).not.toContain(owner.id);
    expect(upload.headers).toEqual({
      'Content-Type': 'image/png',
      'If-None-Match': '*',
    });
    const key = await originalKey(upload.assetId);
    expect(key).toBe(`autographs/${id}/original/${upload.assetId}`);
    expect(key).not.toContain(owner.id);
    expect((await complete(id, ownerToken)).statusCode).toBe(404);
    const bytes = Buffer.from([137, 80, 78, 71]);
    const unsignedCondition = await fetch(upload.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: bytes,
    });
    expect(unsignedCondition.status).toBeGreaterThanOrEqual(400);
    expect(await storage.statObject(key)).toBeNull();
    const wrongType = await fetch(upload.url, {
      method: 'PUT',
      headers: { ...upload.headers, 'Content-Type': 'image/jpeg' },
      body: bytes,
    });
    expect(wrongType.status).toBe(403);
    const put = await fetch(upload.url, {
      method: 'PUT',
      headers: upload.headers,
      body: bytes,
    });
    expect(put.status).toBe(200);
    const anonymous = await fetch(`${s3Endpoint}/${s3Bucket}/${key}`);
    expect(anonymous.status).toBeGreaterThanOrEqual(400);
    expect(await anonymous.text()).not.toContain(bytes.toString());
    expect(await storage.statObject(key)).toEqual({
      sizeBytes: 4,
      contentType: 'image/png',
    });
    const completions = await Promise.all([
      complete(id, ownerToken),
      complete(id, ownerToken),
    ]);
    expect(completions.map((result) => result.statusCode)).toEqual([200, 200]);
    const finished = completions[0];
    if (!finished) throw new Error('Expected completion');
    expect(finished.json()).toMatchObject({
      status: 'uploaded_unverified',
      original: { status: 'uploaded', verifiedSizeBytes: 4 },
    });
    expect(finished.body).not.toContain(key);
    expect(finished.body).not.toContain(upload.url);
    expect((await complete(id, ownerToken)).statusCode).toBe(200);
    expect((await initiate(id, ownerToken)).statusCode).toBe(409);
    const replay = await fetch(upload.url, {
      method: 'PUT',
      headers: upload.headers,
      body: Buffer.from('new!'),
    });
    expect(replay.status).toBe(412);
    expect((await storage.statObject(key))?.sizeBytes).toBe(4);
  });

  it('limits signed URL lifetime and allows browser PUT preflight', async () => {
    const key = `autographs/${randomUUID()}/original/${randomUUID()}`;
    objectKeys.push(key);
    const signed = await storage.signUpload({
      key,
      contentType: 'image/png',
      expiresInSeconds: 1,
    });
    expect(new URL(signed.url).searchParams.get('X-Amz-Expires')).toBe('1');
    const preflight = await fetch(signed.url, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://127.0.0.1:3000',
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'content-type,if-none-match',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(
      'http://127.0.0.1:3000',
    );
    await delay(2200);
    const expired = await fetch(signed.url, {
      method: 'PUT',
      headers: signed.headers,
      body: Buffer.from('late'),
    });
    expect(expired.status).toBe(403);
    expect(await storage.statObject(key)).toBeNull();
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

  it('rejects an actually oversized object even when declared size passed validation', async () => {
    const { ownerToken } = await usersAndTokens();
    const id = (await create(ownerToken)).json().id as string;
    const upload = (await initiate(id, ownerToken)).json() as {
      assetId: string;
      url: string;
      headers: Record<string, string>;
    };
    await originalKey(upload.assetId);
    const put = await fetch(upload.url, {
      method: 'PUT',
      headers: upload.headers,
      body: Buffer.alloc(10 * 1024 * 1024 + 1),
    });
    expect(put.status).toBe(200);
    const result = await complete(id, ownerToken);
    expect(result.statusCode).toBe(413);
    expect(result.json()).toEqual({ error: { code: 'UPLOAD_TOO_LARGE' } });
    expect(
      (
        await app.inject({
          url: `/autographs/${id}`,
          headers: headers(ownerToken),
        })
      ).json().status,
    ).toBe('upload_pending');
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
