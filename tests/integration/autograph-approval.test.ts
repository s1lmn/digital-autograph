import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SessionService } from '../../packages/auth/src/index';
import {
  AutographService,
  type PrivateOriginalStorage,
} from '../../packages/autographs/src/index';
import {
  buildAcceptedApi as buildApi,
  acceptedSession,
} from './first-use-fixtures';
import {
  createDatabase,
  createPgAutographRepository,
  createPgSessionRepository,
} from '../../packages/db/src/index';
import {
  autographAssets,
  autographs,
  users,
} from '../../packages/db/src/schema';

const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/autograph_test') {
  throw new Error(
    'Approval integration tests require the isolated autograph_test database',
  );
}
const database = createDatabase(url);
const sessions = new SessionService(
  createPgSessionRepository(database.pool),
  1209600,
);
const storage: PrivateOriginalStorage = {
  signUpload: async () => {
    throw new Error('Unexpected upload signing');
  },
  statObject: async () => null,
  deleteObject: async () => {},
  signPrivateRead: async (key) =>
    `https://private.example.test/${encodeURIComponent(key)}`,
  getPrivateObject: async () => {
    throw new Error('Unexpected object read');
  },
  putPrivateObject: async () => {
    throw new Error('Unexpected object write');
  },
};
const service = new AutographService(
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
  undefined,
  service,
);

function headers(token?: string) {
  return token
    ? { cookie: `da_session=${token}`, origin: 'http://127.0.0.1:3000' }
    : {};
}

async function fixture(
  status: typeof autographs.$inferInsert.status = 'awaiting_approval',
  withCleaned = true,
) {
  const ownerId = randomUUID();
  const otherId = randomUUID();
  await database.db.insert(users).values([{ id: ownerId }, { id: otherId }]);
  const [autograph] = await database.db
    .insert(autographs)
    .values({ userId: ownerId, source: 'canvas', status })
    .returning();
  if (!autograph) throw new Error('Missing autograph fixture');
  const [asset] = withCleaned
    ? await database.db
        .insert(autographAssets)
        .values({
          autographId: autograph.id,
          role: 'cleaned',
          status: 'uploaded',
          storageKey: `autographs/${autograph.id}/cleaned/fixture.png`,
          actualContentType: 'image/png',
          verifiedSizeBytes: 12,
          width: 4,
          height: 3,
          uploadedAt: new Date(),
        })
        .returning()
    : [];
  return {
    ownerId,
    otherId,
    autographId: autograph.id,
    assetId: asset?.id,
    ownerToken: (await acceptedSession(sessions, database, ownerId)).token,
    otherToken: (await acceptedSession(sessions, database, otherId)).token,
  };
}

async function approve(
  id: string,
  token: string | undefined,
  reviewedAssetId: string | undefined,
) {
  return app.inject({
    method: 'POST',
    url: `/autographs/${id}/approve`,
    headers: headers(token),
    payload: { reviewedAssetId },
  });
}

async function pgError(operation: Promise<unknown>, code: string) {
  try {
    await operation;
    throw new Error(`Expected PostgreSQL error ${code}`);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === code)
      return;
    throw error;
  }
}

describe('user approval with PostgreSQL', () => {
  beforeAll(async () => database.checkConnection());
  beforeEach(async () => database.pool.query('TRUNCATE TABLE users CASCADE'));
  afterAll(async () => {
    await app.close();
    await database.close();
  });

  it('approves exactly the previewed cleaned asset and keeps the preview private', async () => {
    const f = await fixture();
    const before = await app.inject({
      url: `/autographs/${f.autographId}/preview`,
      headers: headers(f.ownerToken),
    });
    expect(before.statusCode).toBe(200);
    expect(before.headers['cache-control']).toBe('no-store');
    expect(before.json().assetId).toBe(f.assetId);
    const result = await approve(
      f.autographId,
      f.ownerToken,
      before.json().assetId,
    );
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({
      id: f.autographId,
      status: 'awaiting_moderation',
    });
    expect(Object.keys(result.json()).sort()).toEqual([
      'approvedAt',
      'id',
      'status',
    ]);
    expect(result.body).not.toContain('storageKey');
    const evidence = await database.pool.query<{
      user_id: string;
      cleaned_asset_id: string;
      approved_at: Date;
    }>(
      'SELECT user_id, cleaned_asset_id, approved_at FROM autograph_user_approvals WHERE autograph_id = $1::uuid',
      [f.autographId],
    );
    expect(evidence.rows).toHaveLength(1);
    expect(evidence.rows[0]).toMatchObject({
      user_id: f.ownerId,
      cleaned_asset_id: f.assetId,
    });
    expect(result.json().approvedAt).toBe(
      evidence.rows[0]?.approved_at.toISOString(),
    );
    const ownerRead = await app.inject({
      url: `/autographs/${f.autographId}`,
      headers: headers(f.ownerToken),
    });
    expect(ownerRead.json()).toMatchObject({
      status: 'awaiting_moderation',
      approvedAt: result.json().approvedAt,
    });
    const after = await app.inject({
      url: `/autographs/${f.autographId}/preview`,
      headers: headers(f.ownerToken),
    });
    expect(after.statusCode).toBe(200);
    expect(after.json().assetId).toBe(f.assetId);
    expect(after.headers['cache-control']).toBe('no-store');
    expect(
      (
        await app.inject({
          url: `/autographs/${f.autographId}/preview`,
          headers: headers(f.otherToken),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/autographs/${f.autographId}/upload`,
          headers: headers(f.ownerToken),
          payload: { contentType: 'image/png', sizeBytes: 5 },
        })
      ).statusCode,
    ).toBe(409);
  });

  it('enforces auth, ownership, reviewed-asset precondition, and valid lifecycle', async () => {
    const f = await fixture();
    expect(
      (await approve(f.autographId, undefined, f.assetId)).statusCode,
    ).toBe(401);
    expect(
      (await approve(f.autographId, f.otherToken, f.assetId)).statusCode,
    ).toBe(403);
    expect(
      (await approve(f.autographId, f.ownerToken, undefined)).statusCode,
    ).toBe(400);
    expect(
      (await approve(f.autographId, f.ownerToken, randomUUID())).json(),
    ).toEqual({ error: { code: 'REVIEWED_ASSET_MISMATCH' } });
    expect(
      (await database.pool.query('SELECT id FROM autograph_user_approvals'))
        .rowCount,
    ).toBe(0);
    const missing = await fixture('awaiting_approval', false);
    expect(
      (
        await approve(missing.autographId, missing.ownerToken, randomUUID())
      ).json(),
    ).toEqual({ error: { code: 'CLEANED_ASSET_NOT_AVAILABLE' } });
    for (const status of [
      'draft',
      'upload_pending',
      'uploaded_unverified',
      'processing',
      'processing_failed',
    ] as const) {
      const invalid = await fixture(status, false);
      expect(
        (
          await approve(invalid.autographId, invalid.ownerToken, randomUUID())
        ).json(),
      ).toEqual({ error: { code: 'AUTOGRAPH_NOT_AWAITING_APPROVAL' } });
    }
  });

  it('rejects approval when only an original exists', async () => {
    const f = await fixture('awaiting_approval', false);
    await database.db.insert(autographAssets).values({
      autographId: f.autographId,
      role: 'original',
      status: 'uploaded',
      storageKey: `autographs/${f.autographId}/original/fixture`,
      expectedContentType: 'image/png',
      expectedSizeBytes: 4,
      verifiedSizeBytes: 4,
      uploadExpiresAt: new Date(Date.now() + 300_000),
      uploadedAt: new Date(),
    });
    expect(
      (await approve(f.autographId, f.ownerToken, randomUUID())).json(),
    ).toEqual({ error: { code: 'CLEANED_ASSET_NOT_AVAILABLE' } });
  });

  it('rejects a cleaned asset identity changed after preview and binds only the newly reviewed one', async () => {
    const f = await fixture();
    const firstPreview = await app.inject({
      url: `/autographs/${f.autographId}/preview`,
      headers: headers(f.ownerToken),
    });
    const replacementId = randomUUID();
    await database.pool.query(
      'UPDATE autograph_assets SET id = $2::uuid WHERE id = $1::uuid',
      [f.assetId, replacementId],
    );
    expect(
      (
        await approve(f.autographId, f.ownerToken, firstPreview.json().assetId)
      ).json(),
    ).toEqual({ error: { code: 'REVIEWED_ASSET_MISMATCH' } });
    expect(
      (await database.pool.query('SELECT id FROM autograph_user_approvals'))
        .rowCount,
    ).toBe(0);
    const nextPreview = await app.inject({
      url: `/autographs/${f.autographId}/preview`,
      headers: headers(f.ownerToken),
    });
    expect(nextPreview.json().assetId).toBe(replacementId);
    expect(
      (await approve(f.autographId, f.ownerToken, replacementId)).statusCode,
    ).toBe(200);
    const evidence = await database.pool.query<{ cleaned_asset_id: string }>(
      'SELECT cleaned_asset_id FROM autograph_user_approvals WHERE autograph_id = $1::uuid',
      [f.autographId],
    );
    expect(evidence.rows[0]?.cleaned_asset_id).toBe(replacementId);
  });

  it('is idempotent and serializes concurrent requests to one approval row', async () => {
    const f = await fixture();
    const [first, second] = await Promise.all([
      approve(f.autographId, f.ownerToken, f.assetId),
      approve(f.autographId, f.ownerToken, f.assetId),
    ]);
    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    expect(first.json().approvedAt).toBe(second.json().approvedAt);
    const repeated = await approve(f.autographId, f.ownerToken, f.assetId);
    expect(repeated.statusCode).toBe(200);
    expect(
      (
        await database.pool.query(
          'SELECT id FROM autograph_user_approvals WHERE autograph_id = $1::uuid',
          [f.autographId],
        )
      ).rowCount,
    ).toBe(1);
    expect((await service.get(f.ownerId, f.autographId)).status).toBe(
      'awaiting_moderation',
    );
    expect(
      (await approve(f.autographId, f.ownerToken, randomUUID())).json(),
    ).toEqual({ error: { code: 'REVIEWED_ASSET_MISMATCH' } });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/autographs/${f.autographId}/upload/complete`,
          headers: headers(f.ownerToken),
          payload: {},
        })
      ).statusCode,
    ).toBe(409);
  });

  it('keeps approval evidence and its cleaned asset immutable', async () => {
    const f = await fixture();
    expect(
      (await approve(f.autographId, f.ownerToken, f.assetId)).statusCode,
    ).toBe(200);
    await pgError(
      database.pool.query(
        'UPDATE autograph_user_approvals SET approved_at = now() WHERE autograph_id = $1::uuid',
        [f.autographId],
      ),
      '23514',
    );
    await pgError(
      database.pool.query(
        'DELETE FROM autograph_user_approvals WHERE autograph_id = $1::uuid',
        [f.autographId],
      ),
      '23514',
    );
    await pgError(
      database.pool.query(
        'UPDATE autograph_assets SET storage_key = $2 WHERE id = $1::uuid',
        [f.assetId, 'changed'],
      ),
      '23514',
    );
    await pgError(
      database.pool.query('DELETE FROM autograph_assets WHERE id = $1::uuid', [
        f.assetId,
      ]),
      '23514',
    );
    await pgError(
      database.pool.query('DELETE FROM users WHERE id = $1::uuid', [f.ownerId]),
      '23503',
    );
  });

  it('enforces one evidence row per Autograph and restrictive foreign keys', async () => {
    const f = await fixture();
    expect(
      (await approve(f.autographId, f.ownerToken, f.assetId)).statusCode,
    ).toBe(200);
    await pgError(
      database.pool.query(
        'INSERT INTO autograph_user_approvals (autograph_id, user_id, cleaned_asset_id) VALUES ($1::uuid, $2::uuid, $3::uuid)',
        [f.autographId, f.ownerId, f.assetId],
      ),
      '23505',
    );
    const other = await fixture();
    await pgError(
      database.pool.query(
        'INSERT INTO autograph_user_approvals (autograph_id, user_id, cleaned_asset_id) VALUES ($1::uuid, $2::uuid, $3::uuid)',
        [other.autographId, randomUUID(), other.assetId],
      ),
      '23503',
    );
    await pgError(
      database.pool.query(
        'INSERT INTO autograph_user_approvals (autograph_id, user_id, cleaned_asset_id) VALUES ($1::uuid, $2::uuid, $3::uuid)',
        [other.autographId, other.ownerId, randomUUID()],
      ),
      '23503',
    );
  });

  it('rolls back evidence if the lifecycle transition fails', async () => {
    const f = await fixture();
    await database.pool.query(`
      CREATE FUNCTION test_reject_approval_transition() RETURNS trigger AS $$
      BEGIN
        IF NEW.status = 'awaiting_moderation' THEN
          RAISE EXCEPTION 'injected transition failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await database.pool.query(`
      CREATE TRIGGER test_reject_approval_transition
      BEFORE UPDATE ON autographs FOR EACH ROW
      EXECUTE FUNCTION test_reject_approval_transition()
    `);
    try {
      await expect(
        service.approveCleanedAutograph(f.ownerId, f.autographId, f.assetId!),
      ).rejects.toThrow(/injected transition failure/);
      expect(
        (
          await database.pool.query(
            'SELECT id FROM autograph_user_approvals WHERE autograph_id = $1::uuid',
            [f.autographId],
          )
        ).rowCount,
      ).toBe(0);
      expect((await service.get(f.ownerId, f.autographId)).status).toBe(
        'awaiting_approval',
      );
    } finally {
      await database.pool.query(
        'DROP TRIGGER test_reject_approval_transition ON autographs',
      );
      await database.pool.query(
        'DROP FUNCTION test_reject_approval_transition()',
      );
    }
  });

  it('fails closed when lifecycle and approval evidence disagree', async () => {
    const f = await fixture('awaiting_moderation');
    expect(
      (await approve(f.autographId, f.ownerToken, f.assetId)).json(),
    ).toEqual({ error: { code: 'APPROVAL_STATE_INCONSISTENT' } });
    expect(
      (
        await app.inject({
          url: `/autographs/${f.autographId}`,
          headers: headers(f.ownerToken),
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          url: `/autographs/${f.autographId}/preview`,
          headers: headers(f.ownerToken),
        })
      ).statusCode,
    ).toBe(409);
  });
});
