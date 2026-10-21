import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildAcceptedApi as buildApi,
  acceptedSession,
} from './first-use-fixtures';
import { SessionService } from '../../packages/auth/src/index';
import {
  createDatabase,
  createPgPricingRepository,
  createPgSessionRepository,
  createPgWallRepository,
} from '../../packages/db/src/index';
import {
  TakeoverQuoteService,
  WallService,
} from '../../packages/walls/src/index';

const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/autograph_test') {
  throw new Error('Pricing tests require isolated autograph_test database');
}

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
  undefined,
  undefined,
  undefined,
  undefined,
  new TakeoverQuoteService(createPgPricingRepository(database.pool)),
);

const configBody = {
  algorithmVersion: 'takeover_ladder_v1',
  currency: 'RUB',
  baseAmountMinor: '50001',
  minimumAmountMinor: '10001',
  maximumAmountMinor: '100001',
  dynamicTakeoverLimit: 3,
  takeoverStepSize: 2,
  stepAmountMinor: '10001',
  decayIntervalSeconds: 60,
  decayAmountMinor: '5001',
  decayFloorAmountMinor: '20001',
  guaranteedVisibilitySeconds: 120,
  activateForNewWalls: false,
} as const;

async function person(role?: 'admin' | 'moderator' | 'finance') {
  const id = randomUUID();
  await database.pool.query('INSERT INTO users (id) VALUES ($1::uuid)', [id]);
  if (role) {
    await database.pool.query(
      'INSERT INTO user_roles (user_id, role) VALUES ($1::uuid, $2::administrative_role)',
      [id, role],
    );
  }
  return { id, token: (await acceptedSession(sessions, database, id)).token };
}

function headers(token: string) {
  return { cookie: `da_session=${token}`, origin: 'http://127.0.0.1:3000' };
}

async function createConfig(
  token: string,
  overrides: Record<string, unknown> = {},
) {
  return app.inject({
    method: 'POST',
    url: '/admin/pricing/configs',
    headers: headers(token),
    payload: { ...configBody, ...overrides },
  });
}

async function createWall(
  ownerId: string,
  options: {
    status?: string;
    startAt?: Date | null;
    endAt?: Date | null;
    pricingConfigId?: string | null;
  } = {},
) {
  const creatorId = randomUUID();
  const wallId = randomUUID();
  const slotId = randomUUID();
  await database.pool.query(
    'INSERT INTO creators (id, owner_user_id) VALUES ($1::uuid, $2::uuid)',
    [creatorId, ownerId],
  );
  await database.pool.query(
    `INSERT INTO walls (id, creator_id, status, start_at, end_at, slot_count, pricing_config_id)
     VALUES ($1::uuid, $2::uuid, $3::wall_status, $4::timestamptz, $5::timestamptz, 1, $6::uuid)`,
    [
      wallId,
      creatorId,
      options.status ?? 'live',
      options.startAt ?? null,
      options.endAt ?? null,
      options.pricingConfigId ?? null,
    ],
  );
  await database.pool.query(
    'INSERT INTO slots (id, wall_id, position) VALUES ($1::uuid, $2::uuid, 0)',
    [slotId, wallId],
  );
  return { creatorId, wallId, slotId };
}

async function place(
  slotId: string,
  userId: string,
  source: 'free_claim' | 'takeover' | 'admin',
  secondsAgo: number,
  active = true,
) {
  const id = randomUUID();
  const startedAt = new Date(Date.now() - secondsAgo * 1000);
  await database.pool.query(
    `INSERT INTO placements (id, slot_id, user_id, source, started_at, ended_at, end_reason)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::placement_source, $5::timestamptz, $6::timestamptz, $7)`,
    [
      id,
      slotId,
      userId,
      source,
      startedAt,
      active ? null : new Date(startedAt.getTime() + 1000),
      active ? null : 'replaced',
    ],
  );
  return id;
}

function quote(
  wallId: string,
  slotId: string,
  token?: string,
  payload: Record<string, unknown> = {},
) {
  return app.inject({
    method: 'POST',
    url: `/walls/${wallId}/slots/${slotId}/takeover-quote`,
    headers: token ? headers(token) : {},
    payload,
  });
}

async function quoteCount(wallId: string) {
  const found = await database.pool.query<{ count: string }>(
    'SELECT count(*) FROM takeover_quotes WHERE wall_id = $1::uuid',
    [wallId],
  );
  return Number(found.rows[0]?.count);
}

describe('Pricing config and persisted takeover quotes', () => {
  beforeAll(async () => database.checkConnection());
  beforeEach(async () => database.pool.query('TRUNCATE TABLE users CASCADE'));
  afterAll(async () => {
    await app.close();
    await database.close();
  });

  it('allows only admin creation and keeps config versions append-only', async () => {
    const admin = await person('admin');
    const ordinary = await person();
    const moderator = await person('moderator');
    const finance = await person('finance');
    for (const actor of [ordinary, moderator, finance]) {
      const denied = await createConfig(actor.token);
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error.code).toBe('FORBIDDEN');
    }
    const anonymous = await app.inject({
      method: 'POST',
      url: '/admin/pricing/configs',
      payload: configBody,
    });
    expect(anonymous.statusCode).toBe(401);
    const created = await createConfig(admin.token);
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    const stored = await database.pool.query<{
      created_by_user_id: string;
      currency: string;
      base_amount_minor: string;
    }>(
      'SELECT created_by_user_id, currency, base_amount_minor FROM pricing_config_versions WHERE id = $1::uuid',
      [id],
    );
    expect(stored.rows[0]).toMatchObject({
      created_by_user_id: admin.id,
      currency: 'RUB',
      base_amount_minor: '50001',
    });
    await expect(
      database.pool.query(
        'UPDATE pricing_config_versions SET base_amount_minor = 1 WHERE id = $1::uuid',
        [id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      database.pool.query(
        'DELETE FROM pricing_config_versions WHERE id = $1::uuid',
        [id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    expect(
      (await createConfig(admin.token, { minimumAmountMinor: '200000' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await createConfig(admin.token, { baseAmountMinor: '0' })).statusCode,
    ).toBe(400);
    expect(
      (await createConfig(admin.token, { takeoverStepSize: 0 })).statusCode,
    ).toBe(400);
    expect(
      (await createConfig(admin.token, { decayIntervalSeconds: 0 })).statusCode,
    ).toBe(400);
    expect(
      (await createConfig(admin.token, { maximumAmountMinor: '100000000001' }))
        .statusCode,
    ).toBe(400);
  });

  it('pins each new Wall to the explicitly activated default and never repins it', async () => {
    const admin = await person('admin');
    const owner = await person();
    const creatorId = randomUUID();
    await database.pool.query(
      'INSERT INTO creators (id, owner_user_id) VALUES ($1::uuid, $2::uuid)',
      [creatorId, owner.id],
    );
    const newWall = () =>
      app.inject({
        method: 'POST',
        url: `/creators/${creatorId}/walls`,
        headers: headers(owner.token),
        payload: { slotCount: 1 },
      });
    const unpriced = await newWall();
    expect(unpriced.statusCode).toBe(201);
    const beforeDefault = await database.pool.query<{
      pricing_config_id: string | null;
    }>('SELECT pricing_config_id FROM walls WHERE id = $1::uuid', [
      unpriced.json().id,
    ]);
    expect(beforeDefault.rows[0]?.pricing_config_id).toBeNull();
    const createdA = await createConfig(admin.token, {
      activateForNewWalls: true,
    });
    const a = createdA.json().id as string;
    const first = await newWall();
    expect(first.statusCode).toBe(201);
    const createdB = await createConfig(admin.token, {
      baseAmountMinor: '70000',
      activateForNewWalls: true,
    });
    const b = createdB.json().id as string;
    const second = await newWall();
    expect(second.statusCode).toBe(201);
    const pinned = await database.pool.query<{
      id: string;
      pricing_config_id: string;
    }>('SELECT id, pricing_config_id FROM walls WHERE id = ANY($1::uuid[])', [
      [first.json().id, second.json().id],
    ]);
    expect(
      new Map(pinned.rows.map((row) => [row.id, row.pricing_config_id])),
    ).toEqual(
      new Map([
        [first.json().id, a],
        [second.json().id, b],
      ]),
    );
    await expect(
      database.pool.query(
        'UPDATE walls SET pricing_config_id = $2::uuid WHERE id = $1::uuid',
        [first.json().id, b],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('quotes the active target with exact Wall-wide takeover count and leaves placements untouched', async () => {
    const admin = await person('admin');
    const buyer = await person();
    const owner = await person();
    const seller = await person();
    const configId = (await createConfig(admin.token)).json().id as string;
    const wall = await createWall(owner.id, { pricingConfigId: configId });
    await place(wall.slotId, owner.id, 'free_claim', 1000, false);
    await place(wall.slotId, seller.id, 'admin', 900, false);
    await place(wall.slotId, seller.id, 'takeover', 800, false);
    await place(wall.slotId, seller.id, 'takeover', 600, false);
    // Keep this pricing fixture inside the fifth decay interval, away from cross-host clock rounding.
    const target = await place(wall.slotId, seller.id, 'takeover', 305);
    const response = await quote(wall.wallId, wall.slotId, buyer.token);
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      wallId: wall.wallId,
      slotId: wall.slotId,
      targetPlacementId: target,
      pricingVersion: configId,
      algorithmVersion: 'takeover_ladder_v1',
      currency: 'RUB',
      amountMinor: '34997',
      explanation: {
        wallTakeoverCount: '3',
        baseAmountMinor: '50001',
        ladderAmountMinor: '60002',
        stepIndex: '1',
        finalAmountMinor: '34997',
      },
    });
    const stored = await database.pool.query<{
      user_id: string;
      target_placement_id: string;
      pricing_config_id: string;
      amount_minor: string;
      wall_takeover_count: string;
      last_takeover_at: Date;
      quoted_at: Date;
      expires_at: Date;
    }>('SELECT * FROM takeover_quotes WHERE id = $1::uuid', [
      response.json().id,
    ]);
    expect(stored.rows[0]).toMatchObject({
      user_id: buyer.id,
      target_placement_id: target,
      pricing_config_id: configId,
      amount_minor: '34997',
      wall_takeover_count: '3',
    });
    expect(stored.rows[0]?.last_takeover_at).toBeInstanceOf(Date);
    expect(
      stored.rows[0]!.expires_at.getTime() -
        stored.rows[0]!.quoted_at.getTime(),
    ).toBe(120_000);
    expect(await quoteCount(wall.wallId)).toBe(1);
    const active = await database.pool.query<{
      id: string;
      ended_at: Date | null;
    }>(
      'SELECT id, ended_at FROM placements WHERE slot_id = $1::uuid AND ended_at IS NULL',
      [wall.slotId],
    );
    expect(active.rows).toEqual([{ id: target, ended_at: null }]);
    await expect(
      database.pool.query(
        'UPDATE takeover_quotes SET amount_minor = 1 WHERE id = $1::uuid',
        [response.json().id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      database.pool.query('DELETE FROM takeover_quotes WHERE id = $1::uuid', [
        response.json().id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    // A newer default changes neither the Wall's pin nor the historical Quote.
    await createConfig(admin.token, {
      baseAmountMinor: '90000',
      activateForNewWalls: true,
    });
    const again = await database.pool.query<{
      amount_minor: string;
      pricing_config_id: string;
    }>(
      'SELECT amount_minor, pricing_config_id FROM takeover_quotes WHERE id = $1::uuid',
      [response.json().id],
    );
    expect(again.rows[0]).toEqual({
      amount_minor: '34997',
      pricing_config_id: configId,
    });
  });

  it('rejects invalid Wall, Slot, ownership, cooldown, missing pricing, and client price inputs', async () => {
    const admin = await person('admin');
    const buyer = await person();
    const seller = await person();
    const configId = (await createConfig(admin.token)).json().id as string;
    const base = await createWall(seller.id, { pricingConfigId: configId });
    await place(base.slotId, seller.id, 'free_claim', 300);
    expect((await quote(base.wallId, base.slotId)).statusCode).toBe(401);
    expect(
      (await quote(base.wallId, base.slotId, buyer.token, { amountMinor: '1' }))
        .statusCode,
    ).toBe(400);
    expect((await quote('bad', base.slotId, buyer.token)).statusCode).toBe(400);
    expect(
      (await quote(randomUUID(), base.slotId, buyer.token)).statusCode,
    ).toBe(404);
    expect(
      (await quote(base.wallId, randomUUID(), buyer.token)).statusCode,
    ).toBe(404);
    expect(
      (await quote(base.wallId, base.slotId, seller.token)).json().error.code,
    ).toBe('OWN_PLACEMENT');
    const missingPricing = await createWall(seller.id);
    await place(missingPricing.slotId, seller.id, 'free_claim', 300);
    expect(
      (
        await quote(missingPricing.wallId, missingPricing.slotId, buyer.token)
      ).json().error.code,
    ).toBe('PRICING_NOT_CONFIGURED');
    expect(
      (await quote(base.wallId, missingPricing.slotId, buyer.token)).json()
        .error.code,
    ).toBe('SLOT_NOT_IN_WALL');
    const empty = await createWall(seller.id, { pricingConfigId: configId });
    expect(
      (await quote(empty.wallId, empty.slotId, buyer.token)).json().error.code,
    ).toBe('SLOT_EMPTY');
    for (const source of ['free_claim', 'takeover', 'admin'] as const) {
      const cooldown = await createWall(seller.id, {
        pricingConfigId: configId,
      });
      await place(cooldown.slotId, seller.id, source, 30);
      const waiting = await quote(
        cooldown.wallId,
        cooldown.slotId,
        buyer.token,
      );
      expect(waiting.json().error.code).toBe('TAKEOVER_COOLDOWN_ACTIVE');
      expect(
        new Date(waiting.json().error.availableAt).getTime(),
      ).toBeGreaterThan(Date.now());
      expect(await quoteCount(cooldown.wallId)).toBe(0);
    }
    for (const status of ['draft', 'scheduled', 'paused', 'ended']) {
      const wall = await createWall(seller.id, {
        status,
        pricingConfigId: configId,
      });
      await place(wall.slotId, seller.id, 'free_claim', 300);
      expect(
        (await quote(wall.wallId, wall.slotId, buyer.token)).json().error.code,
      ).toBe('WALL_NOT_TAKEOVER_ELIGIBLE');
      expect(await quoteCount(wall.wallId)).toBe(0);
    }
    const future = await createWall(seller.id, {
      startAt: new Date(Date.now() + 60_000),
      pricingConfigId: configId,
    });
    await place(future.slotId, seller.id, 'free_claim', 300);
    expect(
      (await quote(future.wallId, future.slotId, buyer.token)).json().error
        .code,
    ).toBe('WALL_NOT_TAKEOVER_ELIGIBLE');
    const elapsed = await createWall(seller.id, {
      endAt: new Date(Date.now() - 1_000),
      pricingConfigId: configId,
    });
    await place(elapsed.slotId, seller.id, 'free_claim', 300);
    expect(
      (await quote(elapsed.wallId, elapsed.slotId, buyer.token)).json().error
        .code,
    ).toBe('WALL_NOT_TAKEOVER_ELIGIBLE');
    expect(await quoteCount(base.wallId)).toBe(0);
  });

  it('permits admin assignment only once for an unpriced Wall and creates concurrent independent Quotes', async () => {
    const admin = await person('admin');
    const owner = await person();
    const buyerA = await person();
    const buyerB = await person();
    const configId = (await createConfig(admin.token)).json().id as string;
    const wall = await createWall(owner.id);
    await place(wall.slotId, owner.id, 'free_claim', 300);
    const assign = (token: string, pricingConfigId = configId) =>
      app.inject({
        method: 'POST',
        url: `/admin/walls/${wall.wallId}/pricing-config`,
        headers: headers(token),
        payload: { pricingConfigId },
      });
    expect((await assign(owner.token)).statusCode).toBe(403);
    expect((await assign(admin.token, randomUUID())).statusCode).toBe(404);
    expect((await assign(admin.token)).statusCode).toBe(200);
    expect((await assign(admin.token)).json().error.code).toBe(
      'WALL_PRICING_ALREADY_SET',
    );
    const [a, b] = await Promise.all([
      quote(wall.wallId, wall.slotId, buyerA.token),
      quote(wall.wallId, wall.slotId, buyerB.token),
    ]);
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(a.json().id).not.toBe(b.json().id);
    expect(a.json().targetPlacementId).toBe(b.json().targetPlacementId);
    expect(a.json().amountMinor).toBe(b.json().amountMinor);
    expect(a.json().amountMinor).toBe('50001');
    expect(await quoteCount(wall.wallId)).toBe(2);
    expect((await assign(admin.token)).json().error.code).toBe(
      'WALL_PRICING_ALREADY_SET',
    );
  });
});
