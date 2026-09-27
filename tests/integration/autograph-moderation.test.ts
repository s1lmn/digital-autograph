import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SessionService } from '../../packages/auth/src/index';
import {
  AutographService,
  ModerationService,
  type PrivateOriginalStorage,
} from '../../packages/autographs/src/index';
import { buildApi } from '../../apps/api/src/app';
import {
  createDatabase,
  createPgAutographModerationRepository,
  createPgAutographRepository,
  createPgSessionRepository,
} from '../../packages/db/src/index';
import {
  autographAssets,
  autographUserApprovals,
  autographs,
  creators,
  userRoles,
  users,
} from '../../packages/db/src/schema';

const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/autograph_test') {
  throw new Error(
    'Moderation tests require the isolated autograph_test database',
  );
}
const database = createDatabase(url);
const sessions = new SessionService(
  createPgSessionRepository(database.pool),
  1209600,
);
const signedReads: Array<{ key: string; ttl: number }> = [];
const storage: PrivateOriginalStorage = {
  signUpload: async () => {
    throw new Error('Unexpected upload');
  },
  statObject: async () => null,
  deleteObject: async () => {},
  signPrivateRead: async (key, ttl) => {
    signedReads.push({ key, ttl });
    return `https://private.example.test/${encodeURIComponent(key)}?temporary=1`;
  },
  getPrivateObject: async () => {
    throw new Error('Unexpected read');
  },
  putPrivateObject: async () => {
    throw new Error('Unexpected write');
  },
};
const autographService = new AutographService(
  createPgAutographRepository(database.pool),
  storage,
  300,
);
const moderationService = new ModerationService(
  createPgAutographModerationRepository(database.pool),
  storage,
  120,
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
  autographService,
  moderationService,
);

async function person(role?: 'moderator' | 'admin' | 'finance') {
  const id = randomUUID();
  await database.db.insert(users).values({ id });
  if (role) await database.db.insert(userRoles).values({ userId: id, role });
  return { id, token: (await sessions.createSession(id)).token };
}

async function pending(ownerId: string, time = new Date()) {
  const [autograph] = await database.db
    .insert(autographs)
    .values({
      userId: ownerId,
      source: 'canvas',
      status: 'awaiting_moderation',
    })
    .returning();
  if (!autograph) throw new Error('Autograph fixture missing');
  const key = `autographs/${autograph.id}/cleaned/${randomUUID()}.png`;
  const [cleaned] = await database.db
    .insert(autographAssets)
    .values({
      autographId: autograph.id,
      role: 'cleaned',
      status: 'uploaded',
      storageKey: key,
      actualContentType: 'image/png',
      verifiedSizeBytes: 12,
      width: 4,
      height: 3,
      uploadedAt: new Date(),
    })
    .returning();
  if (!cleaned) throw new Error('Asset fixture missing');
  const [approval] = await database.db
    .insert(autographUserApprovals)
    .values({
      autographId: autograph.id,
      userId: ownerId,
      cleanedAssetId: cleaned.id,
      approvedAt: time,
    })
    .returning();
  if (!approval) throw new Error('Approval fixture missing');
  return { autograph, cleaned, approval, key };
}

function headers(token?: string) {
  return token
    ? { cookie: `da_session=${token}`, origin: 'http://127.0.0.1:3000' }
    : {};
}
function queue(token?: string, query = '') {
  return app.inject({
    url: `/moderation/autographs${query}`,
    headers: headers(token),
  });
}
function preview(id: string, token?: string) {
  return app.inject({
    url: `/moderation/autographs/${id}/preview`,
    headers: headers(token),
  });
}
function decide(id: string, token: string | undefined, payload: object) {
  return app.inject({
    method: 'POST',
    url: `/moderation/autographs/${id}/decision`,
    headers: headers(token),
    payload,
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

describe('human autograph moderation with PostgreSQL', () => {
  beforeAll(async () => database.checkConnection());
  beforeEach(async () => {
    await database.pool.query('TRUNCATE TABLE users CASCADE');
    signedReads.length = 0;
  });
  afterAll(async () => {
    await app.close();
    await database.close();
  });

  it('authorizes only moderator/admin, never finance, creator ownership, or ordinary users', async () => {
    const owner = await person();
    await database.db.insert(creators).values({ ownerUserId: owner.id });
    const moderator = await person('moderator');
    const admin = await person('admin');
    const finance = await person('finance');
    const item = await pending(owner.id);
    for (const token of [owner.token, finance.token]) {
      expect((await queue(token)).statusCode).toBe(403);
      expect((await preview(item.autograph.id, token)).statusCode).toBe(403);
      expect(
        (await decide(item.autograph.id, token, { decision: 'approved' }))
          .statusCode,
      ).toBe(403);
    }
    expect((await queue()).statusCode).toBe(401);
    expect((await preview(item.autograph.id)).statusCode).toBe(401);
    expect(
      (await decide(item.autograph.id, undefined, { decision: 'approved' }))
        .statusCode,
    ).toBe(401);
    expect((await queue(moderator.token)).statusCode).toBe(200);
    expect((await queue(admin.token)).statusCode).toBe(200);
    expect((await preview(item.autograph.id, moderator.token)).statusCode).toBe(
      200,
    );
    expect(
      (await decide(item.autograph.id, admin.token, { decision: 'approved' }))
        .statusCode,
    ).toBe(200);
  });

  it('lists only pending submissions in deterministic bounded pages without identity data', async () => {
    const owner = await person();
    const moderator = await person('moderator');
    const first = await pending(owner.id, new Date('2026-01-01T00:00:00Z'));
    const second = await pending(owner.id, new Date('2026-01-02T00:00:00Z'));
    const third = await pending(owner.id, new Date('2026-01-03T00:00:00Z'));
    const approved = await pending(owner.id, new Date('2026-01-04T00:00:00Z'));
    const rejected = await pending(owner.id, new Date('2026-01-05T00:00:00Z'));
    await decide(approved.autograph.id, moderator.token, {
      decision: 'approved',
    });
    await decide(rejected.autograph.id, moderator.token, {
      decision: 'rejected',
      reasonCode: 'NOT_AN_AUTOGRAPH',
    });
    await database.db.insert(autographs).values({
      userId: owner.id,
      source: 'photo',
      status: 'awaiting_approval',
    });
    const page1 = await queue(moderator.token, '?limit=2');
    expect(page1.statusCode).toBe(200);
    expect(page1.json().items.map((item: { id: string }) => item.id)).toEqual([
      first.autograph.id,
      second.autograph.id,
    ]);
    expect(Object.keys(page1.json().items[0]).sort()).toEqual([
      'approvedAt',
      'createdAt',
      'id',
      'source',
    ]);
    expect(page1.body).not.toContain(owner.id);
    expect(page1.body).not.toContain('storageKey');
    expect(page1.json().nextCursor).toBe(second.autograph.id);
    const page2 = await queue(
      moderator.token,
      `?limit=2&cursor=${page1.json().nextCursor}`,
    );
    expect(page2.json().items.map((item: { id: string }) => item.id)).toEqual([
      third.autograph.id,
    ]);
    expect(page2.json().nextCursor).toBeNull();
    expect((await queue(moderator.token, '?limit=51')).statusCode).toBe(400);
    expect(
      (await queue(moderator.token, `?cursor=${randomUUID()}`)).json(),
    ).toEqual({ error: { code: 'INVALID_CURSOR' } });
  });

  it('previews only the exact approved cleaned asset with short-lived private URL', async () => {
    const owner = await person();
    const moderator = await person('moderator');
    const item = await pending(owner.id);
    const result = await preview(item.autograph.id, moderator.token);
    expect(result.statusCode).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(Object.keys(result.json()).sort()).toEqual(['expiresAt', 'url']);
    expect(
      new Date(result.json().expiresAt).getTime() - Date.now(),
    ).toBeLessThanOrEqual(120_000);
    expect(signedReads).toEqual([{ key: item.key, ttl: 120 }]);
    expect(result.body).not.toContain('storageKey');
    expect(result.body).not.toContain('/original/');
    expect((await preview(item.autograph.id, owner.token)).statusCode).toBe(
      403,
    );
    await database.pool.query(
      'UPDATE autographs SET status = $2::autograph_status WHERE id = $1::uuid',
      [item.autograph.id, 'ready'],
    );
    expect((await preview(item.autograph.id, moderator.token)).statusCode).toBe(
      409,
    );
  });

  it('approves atomically with exact evidence chain and supports identical retry', async () => {
    const owner = await person();
    const moderator = await person('moderator');
    const admin = await person('admin');
    const item = await pending(owner.id);
    const first = await decide(item.autograph.id, moderator.token, {
      decision: 'approved',
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      id: item.autograph.id,
      status: 'ready',
      decision: 'approved',
      reasonCode: null,
    });
    const evidence = await database.pool.query(
      'SELECT * FROM autograph_moderation_decisions WHERE autograph_id = $1::uuid',
      [item.autograph.id],
    );
    expect(evidence.rows).toHaveLength(1);
    expect(evidence.rows[0]).toMatchObject({
      moderator_user_id: moderator.id,
      user_approval_id: item.approval.id,
      cleaned_asset_id: item.cleaned.id,
      decision: 'approved',
      reason_code: null,
    });
    const retry = await decide(item.autograph.id, admin.token, {
      decision: 'approved',
    });
    expect(retry.json()).toEqual(first.json());
    expect(
      (
        await decide(item.autograph.id, admin.token, {
          decision: 'rejected',
          reasonCode: 'NOT_AN_AUTOGRAPH',
        })
      ).json(),
    ).toEqual({ error: { code: 'MODERATION_ALREADY_DECIDED' } });
    const ownerRead = await app.inject({
      url: `/autographs/${item.autograph.id}`,
      headers: headers(owner.token),
    });
    expect(ownerRead.json().moderation).toMatchObject({
      decision: 'approved',
      reasonCode: null,
    });
    expect(ownerRead.json().status).toBe('ready');
    const ownerPreview = await app.inject({
      url: `/autographs/${item.autograph.id}/preview`,
      headers: headers(owner.token),
    });
    expect(ownerPreview.statusCode).toBe(200);
    expect(ownerPreview.json().assetId).toBe(item.cleaned.id);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/autographs/${item.autograph.id}/approve`,
          headers: headers(owner.token),
          payload: { reviewedAssetId: item.cleaned.id },
        })
      ).statusCode,
    ).toBe(409);
  });

  it('rejects with a stable reason and keeps owner preview private', async () => {
    const owner = await person();
    const moderator = await person('moderator');
    const item = await pending(owner.id);
    const result = await decide(item.autograph.id, moderator.token, {
      decision: 'rejected',
      reasonCode: 'PERSONAL_DATA',
    });
    expect(result.json()).toMatchObject({
      status: 'moderation_rejected',
      decision: 'rejected',
      reasonCode: 'PERSONAL_DATA',
    });
    const ownerRead = await app.inject({
      url: `/autographs/${item.autograph.id}`,
      headers: headers(owner.token),
    });
    expect(ownerRead.json().moderation).toMatchObject({
      decision: 'rejected',
      reasonCode: 'PERSONAL_DATA',
    });
    expect(ownerRead.body).not.toContain(moderator.id);
    expect(
      (
        await app.inject({
          url: `/autographs/${item.autograph.id}/preview`,
          headers: headers(owner.token),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/autographs/${item.autograph.id}/upload/complete`,
          headers: headers(owner.token),
          payload: {},
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await decide(item.autograph.id, moderator.token, {
          decision: 'rejected',
          reasonCode: 'NOT_AN_AUTOGRAPH',
        })
      ).json(),
    ).toEqual({ error: { code: 'MODERATION_ALREADY_DECIDED' } });
  });

  it('rejects malformed decisions and extra client-selected identifiers', async () => {
    const owner = await person();
    const moderator = await person('moderator');
    const item = await pending(owner.id);
    for (const body of [
      { decision: 'approved', reasonCode: 'NOT_AN_AUTOGRAPH' },
      { decision: 'rejected' },
      { decision: 'rejected', reasonCode: 'UNKNOWN' },
      { decision: 'unknown' },
      { decision: 'approved', assetId: item.cleaned.id },
      { decision: 'approved', userId: owner.id },
    ])
      expect(
        (await decide(item.autograph.id, moderator.token, body)).statusCode,
      ).toBe(400);
    expect(
      (
        await database.pool.query(
          'SELECT id FROM autograph_moderation_decisions',
        )
      ).rowCount,
    ).toBe(0);
  });

  it('serializes opposite decisions from two moderators to one matching final state', async () => {
    const owner = await person();
    const a = await person('moderator');
    const b = await person('admin');
    const item = await pending(owner.id);
    const [approve, reject] = await Promise.all([
      decide(item.autograph.id, a.token, { decision: 'approved' }),
      decide(item.autograph.id, b.token, {
        decision: 'rejected',
        reasonCode: 'NOT_AN_AUTOGRAPH',
      }),
    ]);
    expect([approve.statusCode, reject.statusCode].sort()).toEqual([200, 409]);
    const evidence = await database.pool.query(
      'SELECT decision FROM autograph_moderation_decisions WHERE autograph_id = $1::uuid',
      [item.autograph.id],
    );
    expect(evidence.rows).toHaveLength(1);
    const ownerRead = await app.inject({
      url: `/autographs/${item.autograph.id}`,
      headers: headers(owner.token),
    });
    expect(ownerRead.json().status).toBe(
      evidence.rows[0]?.decision === 'approved'
        ? 'ready'
        : 'moderation_rejected',
    );
  });

  it('rolls back evidence when the lifecycle update fails and prevents evidence mutation', async () => {
    const owner = await person();
    const moderator = await person('moderator');
    const item = await pending(owner.id);
    await database.pool.query(
      `CREATE FUNCTION test_reject_moderation_transition() RETURNS trigger AS $$ BEGIN IF NEW.status IN ('ready', 'moderation_rejected') THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
    );
    await database.pool.query(
      'CREATE TRIGGER test_reject_moderation_transition BEFORE UPDATE ON autographs FOR EACH ROW EXECUTE FUNCTION test_reject_moderation_transition()',
    );
    try {
      await expect(
        moderationService.decide(moderator.id, item.autograph.id, {
          decision: 'approved',
        }),
      ).rejects.toThrow(/injected failure/);
      expect(
        (
          await database.pool.query(
            'SELECT id FROM autograph_moderation_decisions',
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (await autographService.get(owner.id, item.autograph.id)).status,
      ).toBe('awaiting_moderation');
    } finally {
      await database.pool.query(
        'DROP TRIGGER test_reject_moderation_transition ON autographs',
      );
      await database.pool.query(
        'DROP FUNCTION test_reject_moderation_transition()',
      );
    }
    expect(
      (
        await decide(item.autograph.id, moderator.token, {
          decision: 'approved',
        })
      ).statusCode,
    ).toBe(200);
    await pgError(
      database.pool.query(
        'UPDATE autograph_moderation_decisions SET reason_code = $1::autograph_moderation_reason WHERE autograph_id = $2::uuid',
        ['PERSONAL_DATA', item.autograph.id],
      ),
      '23514',
    );
    await pgError(
      database.pool.query(
        'DELETE FROM autograph_moderation_decisions WHERE autograph_id = $1::uuid',
        [item.autograph.id],
      ),
      '23514',
    );
    await pgError(
      database.pool.query('DELETE FROM users WHERE id = $1::uuid', [
        moderator.id,
      ]),
      '23503',
    );
  });

  it('fails closed for final status/evidence disagreement', async () => {
    const owner = await person();
    const moderator = await person('moderator');
    const item = await pending(owner.id);
    await database.pool.query(
      "UPDATE autographs SET status = 'ready' WHERE id = $1::uuid",
      [item.autograph.id],
    );
    expect(
      (
        await app.inject({
          url: `/autographs/${item.autograph.id}`,
          headers: headers(owner.token),
        })
      ).json(),
    ).toEqual({ error: { code: 'MODERATION_STATE_INCONSISTENT' } });
    expect(
      (
        await app.inject({
          url: `/autographs/${item.autograph.id}/preview`,
          headers: headers(owner.token),
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await decide(item.autograph.id, moderator.token, {
          decision: 'approved',
        })
      ).statusCode,
    ).toBe(409);
  });

  it('fails closed when final decision references a different approval or asset, or contradicts status', async () => {
    const owner = await person();
    const moderator = await person('moderator');
    const other = await pending(owner.id);
    const cases = [
      {
        decision: 'approved',
        status: 'ready',
        wrongApproval: true,
        wrongAsset: false,
      },
      {
        decision: 'approved',
        status: 'ready',
        wrongApproval: false,
        wrongAsset: true,
      },
      {
        decision: 'rejected',
        status: 'ready',
        wrongApproval: false,
        wrongAsset: false,
      },
      {
        decision: 'approved',
        status: 'moderation_rejected',
        wrongApproval: false,
        wrongAsset: false,
      },
    ] as const;
    for (const scenario of cases) {
      const item = await pending(owner.id);
      await database.pool.query(
        `INSERT INTO autograph_moderation_decisions
           (autograph_id, moderator_user_id, user_approval_id, cleaned_asset_id, decision, reason_code)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid,
                 $5::autograph_moderation_decision, $6::autograph_moderation_reason)`,
        [
          item.autograph.id,
          moderator.id,
          scenario.wrongApproval ? other.approval.id : item.approval.id,
          scenario.wrongAsset ? other.cleaned.id : item.cleaned.id,
          scenario.decision,
          scenario.decision === 'rejected' ? 'NOT_AN_AUTOGRAPH' : null,
        ],
      );
      await database.pool.query(
        'UPDATE autographs SET status = $2::autograph_status WHERE id = $1::uuid',
        [item.autograph.id, scenario.status],
      );
      expect(
        (
          await app.inject({
            url: `/autographs/${item.autograph.id}`,
            headers: headers(owner.token),
          })
        ).json(),
      ).toEqual({ error: { code: 'MODERATION_STATE_INCONSISTENT' } });
      expect(
        (
          await app.inject({
            url: `/autographs/${item.autograph.id}/preview`,
            headers: headers(owner.token),
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await decide(
            item.autograph.id,
            moderator.token,
            scenario.decision === 'rejected'
              ? { decision: 'rejected', reasonCode: 'NOT_AN_AUTOGRAPH' }
              : { decision: 'approved' },
          )
        ).statusCode,
      ).toBe(409);
    }
  });

  it('enforces rejection reason consistency in PostgreSQL and current role at decision time', async () => {
    const owner = await person();
    const moderator = await person('moderator');
    const item = await pending(owner.id);
    await pgError(
      database.pool.query(
        `INSERT INTO autograph_moderation_decisions
         (autograph_id, moderator_user_id, user_approval_id, cleaned_asset_id, decision, reason_code)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'rejected', NULL)`,
        [item.autograph.id, moderator.id, item.approval.id, item.cleaned.id],
      ),
      '23514',
    );
    await database.pool.query(
      "DELETE FROM user_roles WHERE user_id = $1::uuid AND role = 'moderator'",
      [moderator.id],
    );
    expect(
      (
        await decide(item.autograph.id, moderator.token, {
          decision: 'approved',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await database.pool.query(
          'SELECT id FROM autograph_moderation_decisions',
        )
      ).rowCount,
    ).toBe(0);
  });
});
