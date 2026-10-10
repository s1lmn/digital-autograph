import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApi } from '../../apps/api/src/app';
import { SessionService } from '../../packages/auth/src/index';
import {
  createDatabase,
  createPgFreeClaimRepository,
  createPgPlacementHistoryRepository,
  createPgSessionRepository,
  createPgWallRepository,
} from '../../packages/db/src/index';
import {
  FreeClaimService,
  PlacementHistoryService,
  WallService,
} from '../../packages/walls/src/index';
import type { IncidentControls } from '../../apps/api/src/incident-controls';
import type { WallStatus } from '../../packages/domain/src/index';

const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/autograph_test') {
  throw new Error('Free Claim tests require isolated autograph_test database');
}

const database = createDatabase(url);
const sessions = new SessionService(
  createPgSessionRepository(database.pool),
  1209600,
);
const walls = new WallService(createPgWallRepository(database.pool));
const claims = new FreeClaimService(createPgFreeClaimRepository(database.pool));
function incidentApi(controls: IncidentControls) {
  return buildApi(
    database,
    sessions,
    {
      appEnvironment: 'test',
      sessionTtlSeconds: 1209600,
      trustedWebOrigins: ['http://127.0.0.1:3000'],
    },
    undefined,
    undefined,
    walls,
    undefined,
    undefined,
    claims,
    undefined,
    undefined,
    undefined,
    undefined,
    new PlacementHistoryService(
      createPgPlacementHistoryRepository(database.pool),
    ),
    undefined,
    undefined,
    controls,
  );
}
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
  walls,
  undefined,
  undefined,
  claims,
);

async function person() {
  const id = randomUUID();
  await database.pool.query('INSERT INTO users (id) VALUES ($1::uuid)', [id]);
  return { id, token: (await sessions.createSession(id)).token };
}

async function wallFixture(
  ownerId: string,
  options: {
    status?: WallStatus;
    startAt?: Date | null;
    endAt?: Date | null;
    count?: number;
  } = {},
) {
  const creatorId = randomUUID();
  const wallId = randomUUID();
  await database.pool.query(
    'INSERT INTO creators (id, owner_user_id) VALUES ($1::uuid, $2::uuid)',
    [creatorId, ownerId],
  );
  await database.pool.query(
    'INSERT INTO creator_profiles (creator_id, slug, display_name) VALUES ($1::uuid, $2, $3)',
    [creatorId, `creator-${creatorId}`, 'Creator'],
  );
  const count = options.count ?? 2;
  await database.pool.query(
    `INSERT INTO walls (id, creator_id, status, start_at, end_at, slot_count)
     VALUES ($1::uuid, $2::uuid, $3::wall_status, $4::timestamptz, $5::timestamptz, $6::integer)`,
    [
      wallId,
      creatorId,
      options.status ?? 'live',
      options.startAt ?? null,
      options.endAt ?? null,
      count,
    ],
  );
  const slotIds = Array.from({ length: count }, () => randomUUID());
  for (const [position, slotId] of slotIds.entries()) {
    await database.pool.query(
      'INSERT INTO slots (id, wall_id, position) VALUES ($1::uuid, $2::uuid, $3::integer)',
      [slotId, wallId, position],
    );
  }
  return { creatorId, wallId, slotIds };
}

async function autographFixture(
  userId: string,
  status: string = 'ready',
  evidence: 'valid' | 'missing' | 'rejected' | 'wrong_asset' = 'valid',
) {
  const autographId = randomUUID();
  await database.pool.query(
    `INSERT INTO autographs (id, user_id, source, status)
     VALUES ($1::uuid, $2::uuid, 'canvas', $3::autograph_status)`,
    [autographId, userId, status],
  );
  if (evidence === 'missing') return autographId;
  const cleanedId = randomUUID();
  await database.pool.query(
    `INSERT INTO autograph_assets
       (id, autograph_id, role, status, storage_key, actual_content_type,
        verified_size_bytes, width, height, uploaded_at)
     VALUES ($1::uuid, $2::uuid, 'cleaned', 'uploaded', $3,
             'image/png', 12, 4, 3, now())`,
    [cleanedId, autographId, `autographs/${autographId}/cleaned/private.png`],
  );
  const approvalId = randomUUID();
  await database.pool.query(
    `INSERT INTO autograph_user_approvals
       (id, autograph_id, user_id, cleaned_asset_id)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
    [approvalId, autographId, userId, cleanedId],
  );
  const moderatorId = randomUUID();
  await database.pool.query('INSERT INTO users (id) VALUES ($1::uuid)', [
    moderatorId,
  ]);
  if (evidence === 'wrong_asset') return autographId;
  await database.pool.query(
    `INSERT INTO autograph_moderation_decisions
       (autograph_id, moderator_user_id, user_approval_id,
        cleaned_asset_id, decision, reason_code)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid,
             $5::autograph_moderation_decision,
             $6::autograph_moderation_reason)`,
    [
      autographId,
      moderatorId,
      approvalId,
      cleanedId,
      evidence === 'rejected' ? 'rejected' : 'approved',
      evidence === 'rejected' ? 'NOT_AN_AUTOGRAPH' : null,
    ],
  );
  return autographId;
}

function request(
  wallId: string,
  slotId: string,
  autographId: string,
  token?: string,
  extras: Record<string, unknown> = {},
) {
  return app.inject({
    method: 'POST',
    url: `/walls/${wallId}/slots/${slotId}/free-claim`,
    headers: token
      ? { cookie: `da_session=${token}`, origin: 'http://127.0.0.1:3000' }
      : {},
    payload: { autographId, ...extras },
  });
}

async function counts(wallId: string) {
  const found = await database.pool.query<{
    placements: string;
    claims: string;
  }>(
    `SELECT
       (SELECT count(*) FROM placements p JOIN slots s ON s.id = p.slot_id
        WHERE s.wall_id = $1::uuid) AS placements,
       (SELECT count(*) FROM wall_free_claims WHERE wall_id = $1::uuid) AS claims`,
    [wallId],
  );
  return {
    placements: Number(found.rows[0]?.placements),
    claims: Number(found.rows[0]?.claims),
  };
}

async function waitForBlockedStatement(fragment: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const found = await database.pool.query<{ blocked: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_stat_activity
         WHERE datname = current_database()
           AND query LIKE $1
           AND cardinality(pg_blocking_pids(pid)) > 0
       ) AS blocked`,
      [`%${fragment}%`],
    );
    if (found.rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Expected blocked PostgreSQL statement: ${fragment}`);
}

describe('Free Claim and atomic Placement', () => {
  beforeAll(async () => database.checkConnection());
  beforeEach(async () => database.pool.query('TRUNCATE TABLE users CASCADE'));
  afterAll(async () => {
    await app.close();
    await database.close();
  });

  it('claim shutdown rejects concurrent direct requests without creating placements or evidence', async () => {
    const owner = await person();
    const wall = await wallFixture(owner.id);
    const autographId = await autographFixture(owner.id);
    const stopped = incidentApi({
      disableNewPayments: false,
      disableFreeClaims: true,
    });
    try {
      const responses = await Promise.all(
        Array.from({ length: 25 }, () =>
          stopped.inject({
            method: 'POST',
            url: `/walls/${wall.wallId}/slots/${wall.slotIds[0]}/free-claim`,
            headers: {
              cookie: `da_session=${owner.token}`,
              origin: 'http://127.0.0.1:3000',
            },
            payload: { autographId },
          }),
        ),
      );
      for (const response of responses) {
        expect(response.statusCode).toBe(503);
        expect(response.json()).toEqual({
          error: { code: 'FREE_CLAIMS_DISABLED' },
        });
      }
      expect(await counts(wall.wallId)).toEqual({ placements: 0, claims: 0 });
      // A restarted API with the switch off accepts the unchanged request.
      expect(
        (await request(wall.wallId, wall.slotIds[0]!, autographId, owner.token))
          .statusCode,
      ).toBe(201);
      expect(await counts(wall.wallId)).toEqual({ placements: 1, claims: 1 });
    } finally {
      await stopped.close();
    }
  });

  it('payment shutdown independently allows Free Claim and both switches preserve public and personal history', async () => {
    const owner = await person();
    const wall = await wallFixture(owner.id);
    const autographId = await autographFixture(owner.id);
    const headers = {
      cookie: `da_session=${owner.token}`,
      origin: 'http://127.0.0.1:3000',
    };
    const paymentsStopped = incidentApi({
      disableNewPayments: true,
      disableFreeClaims: false,
    });
    const stopped = incidentApi({
      disableNewPayments: true,
      disableFreeClaims: true,
    });
    const url = `/walls/${wall.wallId}/slots/${wall.slotIds[0]}/free-claim`;
    try {
      expect(
        (
          await paymentsStopped.inject({
            method: 'POST',
            url,
            headers,
            payload: { autographId },
          })
        ).statusCode,
      ).toBe(201);
      const before = await counts(wall.wallId);
      // The switch also blocks exact claim retries; read routes provide recovery.
      expect(
        (
          await stopped.inject({
            method: 'POST',
            url,
            headers,
            payload: { autographId },
          })
        ).statusCode,
      ).toBe(503);
      expect(
        (await stopped.inject(`/walls/${wall.wallId}`)).json().slots[0]
          .occupied,
      ).toBe(true);
      const publicHistory = await stopped.inject(
        `/walls/${wall.wallId}/placements`,
      );
      expect(publicHistory.statusCode).toBe(200);
      expect(publicHistory.json().placements).toHaveLength(1);
      const privateHistory = await stopped.inject({
        url: '/me/placements',
        headers,
      });
      expect(privateHistory.statusCode).toBe(200);
      expect(privateHistory.json().items).toHaveLength(1);
      expect((await stopped.inject('/me/placements')).statusCode).toBe(401);
      const stranger = await person();
      expect(
        (
          await stopped.inject({
            url: '/me/placements',
            headers: { cookie: `da_session=${stranger.token}` },
          })
        ).json().items,
      ).toEqual([]);
      expect(
        (await stopped.inject({ url: '/auth/me', headers })).statusCode,
      ).toBe(200);
      expect(await counts(wall.wallId)).toEqual(before);
    } finally {
      await paymentsStopped.close();
      await stopped.close();
    }
  });

  it('commits one Placement and durable evidence, then returns the exact replay', async () => {
    const owner = await person();
    const wall = await wallFixture(owner.id);
    const autographId = await autographFixture(owner.id);
    const slotId = wall.slotIds[0]!;
    const first = await request(wall.wallId, slotId, autographId, owner.token);
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      wallId: wall.wallId,
      slotId,
      autographId,
      placement: { source: 'free_claim' },
    });
    const second = await request(wall.wallId, slotId, autographId, owner.token);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(await counts(wall.wallId)).toEqual({ placements: 1, claims: 1 });
    const stored = await database.pool.query<{
      source: string;
      ended_at: Date | null;
      started_at: Date;
      claimed_at: Date;
    }>(
      `SELECT p.source, p.ended_at, p.started_at, fc.claimed_at
       FROM wall_free_claims fc JOIN placements p ON p.id = fc.placement_id
       WHERE fc.wall_id = $1::uuid`,
      [wall.wallId],
    );
    expect(stored.rows[0]).toMatchObject({
      source: 'free_claim',
      ended_at: null,
    });
    expect(stored.rows[0]?.started_at).toEqual(stored.rows[0]?.claimed_at);
    const publicWall = await app.inject(`/walls/${wall.wallId}`);
    expect(publicWall.json().slots[0]).toMatchObject({
      occupied: true,
      currentPlacement: { source: 'free_claim' },
    });
    const publicCreator = await app.inject(
      `/creators/creator-${wall.creatorId}`,
    );
    for (const body of [publicWall.body, publicCreator.body]) {
      expect(body).not.toContain(owner.id);
      expect(body).not.toContain(autographId);
      expect(body).not.toContain('private.png');
      expect(body).not.toContain('moderatorUserId');
    }
  });

  it('requires auth, valid strict input and trusted origin', async () => {
    const owner = await person();
    const wall = await wallFixture(owner.id);
    const autographId = await autographFixture(owner.id);
    const slot = wall.slotIds[0]!;
    expect((await request(wall.wallId, slot, autographId)).statusCode).toBe(
      401,
    );
    expect(
      (
        await request(wall.wallId, slot, autographId, owner.token, {
          userId: owner.id,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await request('bad', slot, autographId, owner.token)).statusCode,
    ).toBe(400);
    const origin = await app.inject({
      method: 'POST',
      url: `/walls/${wall.wallId}/slots/${slot}/free-claim`,
      headers: {
        cookie: `da_session=${owner.token}`,
        origin: 'https://evil.invalid',
      },
      payload: { autographId },
    });
    expect(origin.statusCode).toBe(403);
    expect(await counts(wall.wallId)).toEqual({ placements: 0, claims: 0 });
  });

  it('rejects non-ready and corrupted ready Autographs without mutation', async () => {
    const owner = await person();
    const wall = await wallFixture(owner.id);
    for (const status of [
      'draft',
      'upload_pending',
      'uploaded_unverified',
      'processing',
      'awaiting_approval',
      'awaiting_moderation',
      'moderation_rejected',
      'processing_failed',
    ]) {
      const autographId = await autographFixture(owner.id, status, 'missing');
      expect(
        (
          await request(wall.wallId, wall.slotIds[0]!, autographId, owner.token)
        ).json(),
      ).toEqual({ error: { code: 'AUTOGRAPH_NOT_READY' } });
    }
    for (const evidence of ['missing', 'rejected', 'wrong_asset'] as const) {
      const autographId = await autographFixture(owner.id, 'ready', evidence);
      expect(
        (
          await request(wall.wallId, wall.slotIds[0]!, autographId, owner.token)
        ).json(),
      ).toEqual({ error: { code: 'AUTOGRAPH_EVIDENCE_INCONSISTENT' } });
    }
    expect(await counts(wall.wallId)).toEqual({ placements: 0, claims: 0 });
  });

  it('rejects another user Autograph, wrong Wall/Slot and occupied Slot', async () => {
    const owner = await person();
    const other = await person();
    const wall = await wallFixture(owner.id);
    const another = await wallFixture(owner.id);
    const autographId = await autographFixture(other.id);
    expect(
      (
        await request(wall.wallId, wall.slotIds[0]!, autographId, owner.token)
      ).json(),
    ).toEqual({ error: { code: 'AUTOGRAPH_NOT_FOUND' } });
    expect(
      (
        await request(
          wall.wallId,
          another.slotIds[0]!,
          autographId,
          other.token,
        )
      ).json(),
    ).toEqual({ error: { code: 'SLOT_NOT_IN_WALL' } });
    for (const source of ['free_claim', 'takeover', 'admin']) {
      const placementId = randomUUID();
      await database.pool.query(
        `INSERT INTO placements (id, slot_id, user_id, source)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::placement_source)`,
        [placementId, wall.slotIds[0], owner.id, source],
      );
      expect(
        (
          await request(wall.wallId, wall.slotIds[0]!, autographId, other.token)
        ).json(),
      ).toEqual({ error: { code: 'SLOT_OCCUPIED' } });
      await database.pool.query(
        `UPDATE placements SET ended_at = now(), end_reason = 'fixture'
         WHERE id = $1::uuid`,
        [placementId],
      );
    }
    expect(await counts(wall.wallId)).toEqual({ placements: 3, claims: 0 });
  });

  it('enforces lifecycle and database time independently of status', async () => {
    const owner = await person();
    const autographId = await autographFixture(owner.id);
    for (const status of [
      'draft',
      'scheduled',
      'paused',
      'ended',
      'archived',
    ] as const) {
      const wall = await wallFixture(owner.id, { status });
      expect(
        (
          await request(wall.wallId, wall.slotIds[0]!, autographId, owner.token)
        ).json(),
      ).toEqual({ error: { code: 'WALL_NOT_CLAIMABLE' } });
    }
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);
    for (const options of [{ startAt: future }, { endAt: past }]) {
      const wall = await wallFixture(owner.id, options);
      expect(
        (
          await request(wall.wallId, wall.slotIds[0]!, autographId, owner.token)
        ).json(),
      ).toEqual({ error: { code: 'WALL_NOT_CLAIMABLE' } });
      expect(await counts(wall.wallId)).toEqual({ placements: 0, claims: 0 });
    }
    const valid = await wallFixture(owner.id, { startAt: past, endAt: future });
    expect(
      (await request(valid.wallId, valid.slotIds[0]!, autographId, owner.token))
        .statusCode,
    ).toBe(201);
  });

  it('keeps one-use evidence after displacement, while allowing other Walls', async () => {
    const owner = await person();
    const wall = await wallFixture(owner.id);
    const otherWall = await wallFixture(owner.id);
    const autographId = await autographFixture(owner.id);
    const otherAutograph = await autographFixture(owner.id);
    const first = await request(
      wall.wallId,
      wall.slotIds[0]!,
      autographId,
      owner.token,
    );
    expect(first.statusCode).toBe(201);
    expect(
      (
        await request(wall.wallId, wall.slotIds[1]!, autographId, owner.token)
      ).json(),
    ).toEqual({ error: { code: 'FREE_CLAIM_ALREADY_USED' } });
    expect(
      (
        await request(
          wall.wallId,
          wall.slotIds[0]!,
          otherAutograph,
          owner.token,
        )
      ).json(),
    ).toEqual({ error: { code: 'FREE_CLAIM_ALREADY_USED' } });
    await database.pool.query(
      `UPDATE placements SET ended_at = now(), end_reason = 'future takeover fixture'
       WHERE id = $1::uuid`,
      [first.json().placement.id],
    );
    expect(
      (
        await request(wall.wallId, wall.slotIds[1]!, autographId, owner.token)
      ).json(),
    ).toEqual({ error: { code: 'FREE_CLAIM_ALREADY_USED' } });
    expect(
      (await request(wall.wallId, wall.slotIds[0]!, autographId, owner.token))
        .statusCode,
    ).toBe(200);
    expect(await counts(wall.wallId)).toEqual({ placements: 1, claims: 1 });
    expect(
      (
        await request(
          otherWall.wallId,
          otherWall.slotIds[0]!,
          autographId,
          owner.token,
        )
      ).statusCode,
    ).toBe(201);
    expect(await counts(otherWall.wallId)).toEqual({
      placements: 1,
      claims: 1,
    });
  });

  it('serializes same Slot and identical request races', async () => {
    const owner = await person();
    const other = await person();
    const wall = await wallFixture(owner.id);
    const firstAutograph = await autographFixture(owner.id);
    const secondAutograph = await autographFixture(other.id);
    const slot = wall.slotIds[0]!;
    const results = await Promise.all([
      request(wall.wallId, slot, firstAutograph, owner.token),
      request(wall.wallId, slot, secondAutograph, other.token),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await counts(wall.wallId)).toEqual({ placements: 1, claims: 1 });
    const secondWall = await wallFixture(owner.id);
    const identical = await Promise.all([
      request(
        secondWall.wallId,
        secondWall.slotIds[0]!,
        firstAutograph,
        owner.token,
      ),
      request(
        secondWall.wallId,
        secondWall.slotIds[0]!,
        firstAutograph,
        owner.token,
      ),
    ]);
    expect(identical.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    expect(identical[0]?.json()).toEqual(identical[1]?.json());
    expect(await counts(secondWall.wallId)).toEqual({
      placements: 1,
      claims: 1,
    });
  });

  it('uses the unique Wall/User guard for different Slot races and rolls back the loser', async () => {
    const owner = await person();
    const wall = await wallFixture(owner.id);
    const autographId = await autographFixture(owner.id);
    const results = await Promise.all(
      wall.slotIds.map((slotId) =>
        request(wall.wallId, slotId, autographId, owner.token),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.statusCode === 409)?.json()).toEqual({
      error: { code: 'FREE_CLAIM_ALREADY_USED' },
    });
    expect(await counts(wall.wallId)).toEqual({ placements: 1, claims: 1 });
  });

  it('rolls back a tentative Placement when concurrent inserts reach the Wall/User unique guard', async () => {
    const owner = await person();
    const wall = await wallFixture(owner.id);
    const autographId = await autographFixture(owner.id);
    let arrivals = 0;
    let release!: () => void;
    const bothInserted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const simultaneous = new FreeClaimService(
      createPgFreeClaimRepository(database.pool, {
        afterPlacementInsert: async () => {
          arrivals += 1;
          if (arrivals === 2) release();
          await bothInserted;
        },
      }),
    );
    const outcomes = await Promise.allSettled(
      wall.slotIds.map((slotId) =>
        simultaneous.claimFreeSlot({
          userId: owner.id,
          wallId: wall.wallId,
          slotId,
          autographId,
        }),
      ),
    );
    expect(arrivals).toBe(2);
    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(outcomes.find((item) => item.status === 'rejected')).toMatchObject({
      reason: { code: 'FREE_CLAIM_ALREADY_USED' },
    });
    expect(await counts(wall.wallId)).toEqual({ placements: 1, claims: 1 });
  });

  it('rolls back Placement if claim evidence insert cannot complete', async () => {
    const owner = await person();
    const wall = await wallFixture(owner.id);
    const autographId = await autographFixture(owner.id);
    const failing = new FreeClaimService(
      createPgFreeClaimRepository(database.pool, {
        afterPlacementInsert: async () => {
          throw new Error('injected claim evidence failure');
        },
      }),
    );
    await expect(
      failing.claimFreeSlot({
        userId: owner.id,
        wallId: wall.wallId,
        slotId: wall.slotIds[0]!,
        autographId,
      }),
    ).rejects.toThrow('injected claim evidence failure');
    expect(await counts(wall.wallId)).toEqual({ placements: 0, claims: 0 });
  });

  it('waits for a paused Wall and then rejects against the committed snapshot', async () => {
    const owner = await person();
    const wall = await wallFixture(owner.id);
    const autographId = await autographFixture(owner.id);
    const blocker = await database.pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        "UPDATE walls SET status = 'paused' WHERE id = $1::uuid",
        [wall.wallId],
      );
      const attempted = request(
        wall.wallId,
        wall.slotIds[0]!,
        autographId,
        owner.token,
      );
      await waitForBlockedStatement('FROM walls WHERE id = $1::uuid FOR SHARE');
      await blocker.query('COMMIT');
      expect((await attempted).json()).toEqual({
        error: { code: 'WALL_NOT_CLAIMABLE' },
      });
      expect(await counts(wall.wallId)).toEqual({ placements: 0, claims: 0 });
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
    }
  });

  it('uses time after Autograph lock waits when a live Wall expires', async () => {
    const owner = await person();
    const endAt = new Date(Date.now() + 400);
    const wall = await wallFixture(owner.id, { endAt });
    const autographId = await autographFixture(owner.id);
    const blocker = await database.pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        'SELECT id FROM autographs WHERE id = $1::uuid FOR UPDATE',
        [autographId],
      );
      const attempted = request(
        wall.wallId,
        wall.slotIds[0]!,
        autographId,
        owner.token,
      );
      await waitForBlockedStatement(
        'FROM autographs WHERE id = $1::uuid FOR SHARE',
      );
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, endAt.getTime() - Date.now() + 50)),
      );
      await blocker.query('COMMIT');
      expect((await attempted).json()).toEqual({
        error: { code: 'WALL_NOT_CLAIMABLE' },
      });
      expect(await counts(wall.wallId)).toEqual({ placements: 0, claims: 0 });
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
    }
  });

  it('lets a committed claim finish before the owner pause transition', async () => {
    const owner = await person();
    const wall = await wallFixture(owner.id);
    const autographId = await autographFixture(owner.id);
    let entered!: () => void;
    let release!: () => void;
    const atPlacement = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const continueClaim = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holding = new FreeClaimService(
      createPgFreeClaimRepository(database.pool, {
        afterPlacementInsert: async () => {
          entered();
          await continueClaim;
        },
      }),
    );
    const claimPromise = holding.claimFreeSlot({
      userId: owner.id,
      wallId: wall.wallId,
      slotId: wall.slotIds[0]!,
      autographId,
    });
    try {
      await atPlacement;
      const transition = walls.transitionWall(owner.id, wall.wallId, 'pause');
      await waitForBlockedStatement('FOR UPDATE OF w, c');
      release();
      expect((await claimPromise).created).toBe(true);
      expect((await transition).status).toBe('paused');
      expect(await counts(wall.wallId)).toEqual({ placements: 1, claims: 1 });
    } finally {
      release();
    }
  });

  it('retains append-only claim evidence', async () => {
    const owner = await person();
    const wall = await wallFixture(owner.id);
    const autographId = await autographFixture(owner.id);
    const response = await request(
      wall.wallId,
      wall.slotIds[0]!,
      autographId,
      owner.token,
    );
    const claimId = response.json().claimId as string;
    for (const sql of [
      'UPDATE wall_free_claims SET claimed_at = now() WHERE id = $1::uuid',
      'DELETE FROM wall_free_claims WHERE id = $1::uuid',
    ]) {
      await expect(database.pool.query(sql, [claimId])).rejects.toMatchObject({
        code: '23514',
      });
    }
  });
});
