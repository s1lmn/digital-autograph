import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { buildApi } from '../../apps/api/src/app';
import { SessionService } from '../../packages/auth/src/index';
import { AutographService } from '../../packages/autographs/src/index';
import {
  createDatabase,
  createPgAutographRepository,
  createPgFreeClaimRepository,
  createPgPublicPlacementMediaRepository,
  createPgSessionRepository,
  createPgWallRepository,
} from '../../packages/db/src/index';
import { createPrivateS3Storage } from '../../packages/integrations/src/private-s3';
import {
  FreeClaimService,
  PublicPlacementMediaService,
  WallService,
} from '../../packages/walls/src/index';

const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/autograph_test') {
  throw new Error(
    'Public media tests require isolated autograph_test database',
  );
}
const endpoint = process.env.S3_ENDPOINT;
const bucket = process.env.S3_BUCKET;
if (!endpoint || !bucket || !process.env.S3_REGION) {
  throw new Error('Public media tests require local private MinIO');
}
const storage = createPrivateS3Storage({
  endpoint,
  bucket,
  region: process.env.S3_REGION,
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
});
const database = createDatabase(url);
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
  new WallService(createPgWallRepository(database.pool)),
  new AutographService(
    createPgAutographRepository(database.pool),
    storage,
    300,
  ),
  undefined,
  new FreeClaimService(createPgFreeClaimRepository(database.pool)),
  new PublicPlacementMediaService(
    createPgPublicPlacementMediaRepository(database.pool),
    storage,
  ),
);

async function person() {
  const id = randomUUID();
  await database.pool.query('INSERT INTO users (id) VALUES ($1::uuid)', [id]);
  return { id, token: (await sessions.createSession(id)).token };
}

async function wallFixture(ownerId: string) {
  const creatorId = randomUUID();
  const wallId = randomUUID();
  const slotId = randomUUID();
  const emptySlotId = randomUUID();
  await database.pool.query(
    'INSERT INTO creators (id, owner_user_id) VALUES ($1::uuid, $2::uuid)',
    [creatorId, ownerId],
  );
  await database.pool.query(
    'INSERT INTO creator_profiles (creator_id, slug, display_name) VALUES ($1::uuid, $2, $3)',
    [creatorId, `creator-${creatorId}`, 'Public Creator'],
  );
  await database.pool.query(
    `INSERT INTO walls (id, creator_id, status, slot_count)
     VALUES ($1::uuid, $2::uuid, 'live', 2)`,
    [wallId, creatorId],
  );
  for (const [position, id] of [slotId, emptySlotId].entries()) {
    await database.pool.query(
      'INSERT INTO slots (id, wall_id, position) VALUES ($1::uuid, $2::uuid, $3)',
      [id, wallId, position],
    );
  }
  return { wallId, slotId, emptySlotId, creatorId };
}

async function png(color: string): Promise<Buffer> {
  return sharp({
    create: { width: 2, height: 2, channels: 4, background: color },
  })
    .png()
    .toBuffer();
}

async function autographFixture(
  ownerId: string,
  options: {
    status?: string;
    approval?: boolean;
    moderation?: 'approved' | 'rejected' | 'missing';
    missingObject?: boolean;
    wrongCleanedReference?: boolean;
  } = {},
) {
  const id = randomUUID();
  const originalKey = `autographs/${id}/original/${randomUUID()}`;
  const cleanedKey = `autographs/${id}/cleaned/${randomUUID()}.png`;
  const original = await png('#e02020');
  const cleaned = await png('#102030');
  await database.pool.query(
    `INSERT INTO autographs (id, user_id, source, status)
     VALUES ($1::uuid, $2::uuid, 'canvas', $3::autograph_status)`,
    [id, ownerId, options.status ?? 'ready'],
  );
  await storage.putPrivateObject(originalKey, original);
  await database.pool.query(
    `INSERT INTO autograph_assets
      (autograph_id, role, status, storage_key, expected_content_type,
       expected_size_bytes, verified_size_bytes, upload_expires_at, uploaded_at)
     VALUES ($1::uuid, 'original', 'uploaded', $2, 'image/png',
             $3, $3, now() + interval '1 hour', now())`,
    [id, originalKey, original.length],
  );
  if (!options.missingObject)
    await storage.putPrivateObject(cleanedKey, cleaned);
  const cleanedId = randomUUID();
  await database.pool.query(
    `INSERT INTO autograph_assets
      (id, autograph_id, role, status, storage_key, actual_content_type,
       verified_size_bytes, width, height, uploaded_at)
     VALUES ($1::uuid, $2::uuid, 'cleaned', 'uploaded', $3, 'image/png',
             $4, 2, 2, now())`,
    [cleanedId, id, cleanedKey, cleaned.length],
  );
  let approvedAssetId = cleanedId;
  if (options.wrongCleanedReference) {
    const another = randomUUID();
    approvedAssetId = randomUUID();
    await database.pool.query(
      "INSERT INTO autographs (id, user_id, source, status) VALUES ($1::uuid, $2::uuid, 'canvas', 'draft')",
      [another, ownerId],
    );
    await database.pool.query(
      `INSERT INTO autograph_assets
        (id, autograph_id, role, status, storage_key, actual_content_type,
         verified_size_bytes, width, height, uploaded_at)
       VALUES ($1::uuid, $2::uuid, 'cleaned', 'uploaded', $3, 'image/png',
               $4, 2, 2, now())`,
      [
        approvedAssetId,
        another,
        `autographs/${another}/cleaned/wrong.png`,
        cleaned.length,
      ],
    );
  }
  if (options.approval === false) {
    return { id, original, cleaned, originalKey, cleanedKey, cleanedId };
  }
  const approvalId = randomUUID();
  await database.pool.query(
    `INSERT INTO autograph_user_approvals
      (id, autograph_id, user_id, cleaned_asset_id)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
    [approvalId, id, ownerId, approvedAssetId],
  );
  if (options.moderation !== 'missing') {
    const moderator = await person();
    const decision = options.moderation ?? 'approved';
    await database.pool.query(
      `INSERT INTO autograph_moderation_decisions
        (autograph_id, moderator_user_id, user_approval_id,
         cleaned_asset_id, decision, reason_code)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid,
               $5::autograph_moderation_decision,
               $6::autograph_moderation_reason)`,
      [
        id,
        moderator.id,
        approvalId,
        approvedAssetId,
        decision,
        decision === 'rejected' ? 'NOT_AN_AUTOGRAPH' : null,
      ],
    );
  }
  return { id, original, cleaned, originalKey, cleanedKey, cleanedId };
}

async function placementFixture(
  slotId: string,
  userId: string,
  autographId: string | null,
) {
  const id = randomUUID();
  await database.pool.query(
    `INSERT INTO placements (id, slot_id, user_id, autograph_id, source)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'admin')`,
    [id, slotId, userId, autographId],
  );
  return id;
}

function media(id: string) {
  return app.inject(`/public/placements/${id}/autograph`);
}

describe('public Placement media and ready selection with PostgreSQL and MinIO', () => {
  beforeAll(async () => {
    await database.checkConnection();
    await storage.bootstrapLocalBucket();
  });
  beforeEach(async () => database.pool.query('TRUNCATE TABLE users CASCADE'));
  afterAll(async () => {
    await app.close();
    await database.close();
    storage.close();
  });

  it('serves only the cleaned PNG through the API while MinIO stays private', async () => {
    const owner = await person();
    const wall = await wallFixture(owner.id);
    const autograph = await autographFixture(owner.id);
    const placementId = await placementFixture(
      wall.slotId,
      owner.id,
      autograph.id,
    );
    const response = await media(placementId);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/png');
    expect(response.headers['content-disposition']).toBe('inline');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('public, max-age=60');
    expect(response.rawPayload).toEqual(autograph.cleaned);
    expect(response.rawPayload).not.toEqual(autograph.original);
    const browserImage = await app.inject({
      url: `/public/placements/${placementId}/autograph`,
      headers: { origin: 'http://127.0.0.1:3000' },
    });
    expect(browserImage.statusCode).toBe(200);
    expect(browserImage.headers['access-control-allow-origin']).toBe(
      'http://127.0.0.1:3000',
    );
    for (const key of [autograph.originalKey, autograph.cleanedKey]) {
      const anonymous = await fetch(`${endpoint}/${bucket}/${key}`);
      expect(anonymous.status).toBe(403);
    }
    const publicWall = await app.inject(`/walls/${wall.wallId}`);
    expect(publicWall.headers['cache-control']).toBe('no-store');
    expect(publicWall.json().slots[0]).toMatchObject({
      occupied: true,
      currentPlacement: {
        id: placementId,
        mediaPath: `/public/placements/${placementId}/autograph`,
      },
    });
    expect(publicWall.json().slots[1]).toMatchObject({
      occupied: false,
      currentPlacement: null,
    });
    for (const status of ['paused', 'ended']) {
      await database.pool.query(
        'UPDATE walls SET status = $2::wall_status WHERE id = $1::uuid',
        [wall.wallId, status],
      );
      expect((await media(placementId)).statusCode).toBe(200);
      expect(
        (await app.inject(`/walls/${wall.wallId}`)).json().slots[0]
          .currentPlacement.mediaPath,
      ).toBe(`/public/placements/${placementId}/autograph`);
    }
    const publicCreator = await app.inject(
      `/creators/creator-${wall.creatorId}`,
    );
    for (const body of [publicWall.body, publicCreator.body]) {
      for (const secret of [
        owner.id,
        autograph.id,
        autograph.cleanedId,
        autograph.originalKey,
        autograph.cleanedKey,
        'moderatorUserId',
        'signed',
      ])
        expect(body).not.toContain(secret);
    }
  });

  it('closes the backend free loop from claim to public Wall image bytes', async () => {
    const owner = await person();
    const wall = await wallFixture(owner.id);
    const autograph = await autographFixture(owner.id);
    const claim = await app.inject({
      method: 'POST',
      url: `/walls/${wall.wallId}/slots/${wall.slotId}/free-claim`,
      headers: {
        cookie: `da_session=${owner.token}`,
        origin: 'http://127.0.0.1:3000',
      },
      payload: { autographId: autograph.id },
    });
    expect(claim.statusCode).toBe(201);
    const placementId = claim.json().placement.id as string;
    const publicWall = await app.inject(`/walls/${wall.wallId}`);
    expect(publicWall.json().slots[0].currentPlacement.mediaPath).toBe(
      `/public/placements/${placementId}/autograph`,
    );
    expect((await media(placementId)).rawPayload).toEqual(autograph.cleaned);
  });

  it('returns a safe 404 for ended, null, non-ready and mismatched owner Placements', async () => {
    const owner = await person();
    const other = await person();
    const wall = await wallFixture(owner.id);
    const autograph = await autographFixture(owner.id);
    const placementId = await placementFixture(
      wall.slotId,
      owner.id,
      autograph.id,
    );
    await database.pool.query(
      "UPDATE placements SET ended_at = now(), end_reason = 'test' WHERE id = $1::uuid",
      [placementId],
    );
    expect((await media(placementId)).statusCode).toBe(404);
    const nullId = await placementFixture(wall.slotId, owner.id, null);
    expect((await media(nullId)).statusCode).toBe(404);
    await database.pool.query(
      "UPDATE placements SET ended_at = now(), end_reason = 'test' WHERE id = $1::uuid",
      [nullId],
    );
    const mismatchId = await placementFixture(
      wall.slotId,
      other.id,
      autograph.id,
    );
    expect((await media(mismatchId)).statusCode).toBe(404);
    const publicWall = await app.inject(`/walls/${wall.wallId}`);
    expect(publicWall.json().slots[0]).toMatchObject({
      occupied: true,
      currentPlacement: { mediaPath: null },
    });
  });

  it('fails closed on missing, rejected or mismatched moderation evidence', async () => {
    const owner = await person();
    const scenarios = [
      { approval: false },
      { moderation: 'missing' as const },
      { moderation: 'rejected' as const },
      { wrongCleanedReference: true },
      { status: 'awaiting_moderation' },
    ];
    for (const scenario of scenarios) {
      const wall = await wallFixture(owner.id);
      const autograph = await autographFixture(owner.id, scenario);
      const placementId = await placementFixture(
        wall.slotId,
        owner.id,
        autograph.id,
      );
      const response = await media(placementId);
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain(autograph.cleanedKey);
      const publicWall = await app.inject(`/walls/${wall.wallId}`);
      expect(publicWall.json().slots[0]).toMatchObject({
        occupied: true,
        currentPlacement: { mediaPath: null },
      });
    }
  });

  it('hides a missing private cleaned object behind a safe 404', async () => {
    const owner = await person();
    const wall = await wallFixture(owner.id);
    const autograph = await autographFixture(owner.id, { missingObject: true });
    const placementId = await placementFixture(
      wall.slotId,
      owner.id,
      autograph.id,
    );
    const response = await media(placementId);
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain(autograph.cleanedKey);
  });

  it('lists only the owner valid ready Autographs with safe bounded metadata', async () => {
    const owner = await person();
    const other = await person();
    const good = await autographFixture(owner.id);
    await autographFixture(owner.id, {
      status: 'awaiting_moderation',
      moderation: 'missing',
    });
    await autographFixture(owner.id, { moderation: 'rejected' });
    await autographFixture(owner.id, { approval: false });
    await autographFixture(other.id);
    const response = await app.inject({
      url: '/autographs?status=ready',
      headers: { cookie: `da_session=${owner.token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    expect(response.json().items[0]).toMatchObject({
      id: good.id,
      source: 'canvas',
    });
    for (const secret of [good.cleanedKey, good.cleanedId, good.originalKey]) {
      expect(response.body).not.toContain(secret);
    }
    expect((await app.inject('/autographs?status=ready')).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          url: '/autographs?status=draft',
          headers: { cookie: `da_session=${owner.token}` },
        })
      ).statusCode,
    ).toBe(400);
  });
});
