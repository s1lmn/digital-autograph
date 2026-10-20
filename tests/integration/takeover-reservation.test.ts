import { createHash, randomUUID } from 'node:crypto';
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
  createPgTakeoverReservationRepository,
} from '../../packages/db/src/index';
import {
  TakeoverQuoteService,
  TakeoverReservationService,
} from '../../packages/walls/src/index';

const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/autograph_test') {
  throw new Error('Reservation tests require isolated autograph_test database');
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
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  new TakeoverQuoteService(createPgPricingRepository(database.pool)),
  new TakeoverReservationService(
    createPgTakeoverReservationRepository(database.pool),
  ),
);

async function person() {
  const id = randomUUID();
  await database.pool.query('INSERT INTO users (id) VALUES ($1::uuid)', [id]);
  return { id, token: (await acceptedSession(sessions, database, id)).token };
}

function headers(token: string, key?: string) {
  return {
    cookie: `da_session=${token}`,
    origin: 'http://127.0.0.1:3000',
    ...(key && { 'idempotency-key': key }),
  };
}

async function fixture(
  slotCount = 1,
  visibilitySeconds = 0,
  placementSecondsAgo = 600,
) {
  const owner = await person();
  const occupant = await person();
  const config = await database.pool.query<{ id: string }>(
    `INSERT INTO pricing_config_versions
       (algorithm_version, currency, base_amount_minor,
        minimum_amount_minor, maximum_amount_minor, dynamic_takeover_limit,
        takeover_step_size, step_amount_minor, decay_interval_seconds,
        decay_amount_minor, decay_floor_amount_minor,
        guaranteed_visibility_seconds, created_by_user_id)
     VALUES ('takeover_ladder_v1', 'RUB', 65000, 10000, 100000, 3,
             1, 1000, 60, 100, 10000, $1::integer, $2::uuid)
     RETURNING id`,
    [visibilitySeconds, owner.id],
  );
  const configId = config.rows[0]!.id;
  const creatorId = randomUUID();
  const wallId = randomUUID();
  await database.pool.query(
    'INSERT INTO creators (id, owner_user_id) VALUES ($1::uuid, $2::uuid)',
    [creatorId, owner.id],
  );
  await database.pool.query(
    `INSERT INTO walls (id, creator_id, pricing_config_id, status, slot_count)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'live', $4::integer)`,
    [wallId, creatorId, configId, slotCount],
  );
  const slots: Array<{ slotId: string; placementId: string }> = [];
  for (let position = 0; position < slotCount; position++) {
    const slotId = randomUUID();
    const placementId = randomUUID();
    await database.pool.query(
      'INSERT INTO slots (id, wall_id, position) VALUES ($1::uuid, $2::uuid, $3)',
      [slotId, wallId, position],
    );
    await database.pool.query(
      `INSERT INTO placements (id, slot_id, user_id, source, started_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'free_claim',
               clock_timestamp() - $4::integer * interval '1 second')`,
      [placementId, slotId, occupant.id, placementSecondsAgo],
    );
    slots.push({ slotId, placementId });
  }
  return { owner, occupant, wallId, configId, slots };
}

async function quote(wallId: string, slotId: string, token: string) {
  const response = await app.inject({
    method: 'POST',
    url: `/walls/${wallId}/slots/${slotId}/takeover-quote`,
    headers: headers(token),
    payload: {},
  });
  expect(response.statusCode).toBe(201);
  return response.json() as {
    id: string;
    amountMinor: string;
    targetPlacementId: string;
    pricingVersion: string;
  };
}

function reserve(quoteId: string, token?: string, key?: string) {
  return app.inject({
    method: 'POST',
    url: '/takeover-reservations',
    headers: token ? headers(token, key) : {},
    payload: { quoteId },
  });
}

function read(id: string, token: string) {
  return app.inject({
    method: 'GET',
    url: `/takeover-reservations/${id}`,
    headers: headers(token),
  });
}

function cancel(
  id: string,
  token: string,
  payload: Record<string, unknown> = {},
) {
  return app.inject({
    method: 'POST',
    url: `/takeover-reservations/${id}/cancel`,
    headers: headers(token),
    payload,
  });
}

async function count(slotId: string) {
  const result = await database.pool.query<{ active: string; total: string }>(
    `SELECT count(*) FILTER (WHERE status = 'active') AS active,
            count(*) AS total FROM takeover_reservations WHERE slot_id = $1::uuid`,
    [slotId],
  );
  return {
    active: Number(result.rows[0]!.active),
    total: Number(result.rows[0]!.total),
  };
}

async function waitForLock(fragment: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await database.pool.query<{ waiting: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'
           AND query LIKE $1
       ) AS waiting`,
      [`%${fragment}%`],
    );
    if (result.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for PostgreSQL lock: ${fragment}`);
}

describe('Takeover Reservation / Slot locking', () => {
  beforeAll(async () => database.checkConnection());
  beforeEach(async () => database.pool.query('TRUNCATE TABLE users CASCADE'));
  afterAll(async () => {
    await app.close();
    await database.close();
  });

  it('copies immutable Quote money and target; exact replay is one row', async () => {
    const f = await fixture();
    const buyer = await person();
    const q = await quote(f.wallId, f.slots[0]!.slotId, buyer.token);
    // A newer platform default must not alter this existing Quote.
    const newer = await database.pool.query<{ id: string }>(
      `INSERT INTO pricing_config_versions
         (algorithm_version, currency, base_amount_minor,
          minimum_amount_minor, maximum_amount_minor, dynamic_takeover_limit,
          takeover_step_size, step_amount_minor, decay_interval_seconds,
          decay_amount_minor, decay_floor_amount_minor,
          guaranteed_visibility_seconds, created_by_user_id)
       VALUES ('takeover_ladder_v1', 'RUB', 90000, 10000, 100000, 3,
               1, 1000, 60, 100, 10000, 0, $1::uuid) RETURNING id`,
      [f.owner.id],
    );
    await database.pool.query(
      `INSERT INTO platform_pricing_default (singleton_id, pricing_config_id)
       VALUES (1, $1::uuid)`,
      [newer.rows[0]!.id],
    );
    const first = await reserve(q.id, buyer.token, 'checkout-attempt-0001');
    expect(first.statusCode).toBe(201);
    const body = first.json();
    expect(body).toMatchObject({
      quoteId: q.id,
      wallId: f.wallId,
      slotId: f.slots[0]!.slotId,
      targetPlacementId: q.targetPlacementId,
      pricingConfigId: q.pricingVersion,
      amountMinor: q.amountMinor,
      currency: 'RUB',
      status: 'active',
    });
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(
      new Date(body.expiresAt).getTime() - new Date(body.createdAt).getTime(),
    ).toBe(240_000);
    const replay = await reserve(q.id, buyer.token, 'checkout-attempt-0001');
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(body);
    expect(await count(f.slots[0]!.slotId)).toEqual({ active: 1, total: 1 });
    const raw = await database.pool.query<{
      idempotency_key_hash: string;
      amount_minor: string;
    }>(
      'SELECT idempotency_key_hash, amount_minor FROM takeover_reservations WHERE id = $1::uuid',
      [body.id],
    );
    expect(raw.rows[0]!.idempotency_key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(raw.rows[0]!.idempotency_key_hash).not.toContain('checkout');
    expect(raw.rows[0]!.amount_minor).toBe(q.amountMinor);
    await expect(
      database.pool.query(
        'UPDATE takeover_reservations SET amount_minor = 1 WHERE id = $1::uuid',
        [body.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      database.pool.query(
        'DELETE FROM takeover_reservations WHERE id = $1::uuid',
        [body.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    const secondQuote = await quote(f.wallId, f.slots[0]!.slotId, buyer.token);
    await expect(
      database.pool.query(
        `INSERT INTO takeover_reservations
           (quote_id, user_id, wall_id, slot_id, target_placement_id,
            pricing_config_id, currency, amount_minor, idempotency_key_hash,
            created_at, expires_at)
         SELECT id, user_id, wall_id, slot_id, target_placement_id,
                pricing_config_id, currency, amount_minor + 1, repeat('b', 64),
                clock_timestamp(), clock_timestamp() + interval '4 minutes'
         FROM takeover_quotes WHERE id = $1::uuid`,
        [secondQuote.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('requires authentication, ownership, strict input, and a valid idempotency key', async () => {
    const f = await fixture();
    const buyer = await person();
    const stranger = await person();
    const q = await quote(f.wallId, f.slots[0]!.slotId, buyer.token);
    expect((await reserve(q.id)).statusCode).toBe(401);
    expect(
      (await reserve(q.id, stranger.token, 'stranger-request-01')).json().error
        .code,
    ).toBe('QUOTE_NOT_FOUND');
    expect((await reserve(q.id, buyer.token)).json().error.code).toBe(
      'IDEMPOTENCY_KEY_REQUIRED',
    );
    expect((await reserve(q.id, buyer.token, 'short')).json().error.code).toBe(
      'INVALID_IDEMPOTENCY_KEY',
    );
    const injected = await app.inject({
      method: 'POST',
      url: '/takeover-reservations',
      headers: headers(buyer.token, 'strict-body-key-01'),
      payload: { quoteId: q.id, amountMinor: '1' },
    });
    expect(injected.json().error.code).toBe('INVALID_REQUEST');
    const created = await reserve(q.id, buyer.token, 'valid-reserve-key-01');
    const id = created.json().id as string;
    expect((await read(id, stranger.token)).statusCode).toBe(404);
    expect((await cancel(id, stranger.token)).statusCode).toBe(404);
    expect((await read(id, buyer.token)).json().status).toBe('active');
    expect(await count(f.slots[0]!.slotId)).toEqual({ active: 1, total: 1 });
  });

  it('cancellation frees the Slot, remains one-shot, and is idempotent', async () => {
    const f = await fixture();
    const buyer = await person();
    const nextBuyer = await person();
    const q = await quote(f.wallId, f.slots[0]!.slotId, buyer.token);
    const nextQuote = await quote(
      f.wallId,
      f.slots[0]!.slotId,
      nextBuyer.token,
    );
    const created = await reserve(q.id, buyer.token, 'cancel-test-key-001');
    const id = created.json().id as string;
    expect(
      (await cancel(id, buyer.token, { unexpected: true })).statusCode,
    ).toBe(400);
    expect((await cancel(id, buyer.token)).json().status).toBe('cancelled');
    expect((await cancel(id, buyer.token)).json().status).toBe('cancelled');
    const retry = await reserve(q.id, buyer.token, 'cancel-test-key-001');
    expect(retry.statusCode).toBe(200);
    expect(retry.json().status).toBe('cancelled');
    expect(
      (await reserve(q.id, buyer.token, 'another-key-after-cancel')).json()
        .error.code,
    ).toBe('QUOTE_ALREADY_RESERVED');
    expect(
      (await reserve(nextQuote.id, nextBuyer.token, 'next-after-cancel-01'))
        .statusCode,
    ).toBe(201);
    expect(await count(f.slots[0]!.slotId)).toEqual({ active: 1, total: 2 });
  });

  it('expires historical rows lazily and admits a fresh Quote', async () => {
    const f = await fixture();
    const buyer = await person();
    const nextBuyer = await person();
    const q = await quote(f.wallId, f.slots[0]!.slotId, buyer.token);
    // Create an already-expired active historical row directly; no clock mocking.
    const oldKey = 'expired-row-retry-01';
    const oldHash = createHash('sha256').update(oldKey).digest('hex');
    await database.pool.query(
      `INSERT INTO takeover_reservations
         (quote_id, user_id, wall_id, slot_id, target_placement_id,
          pricing_config_id, currency, amount_minor, idempotency_key_hash,
          created_at, expires_at)
       SELECT id, user_id, wall_id, slot_id, target_placement_id,
              pricing_config_id, currency, amount_minor, $2,
              clock_timestamp() - interval '5 minutes',
              clock_timestamp() - interval '1 minute'
       FROM takeover_quotes WHERE id = $1::uuid`,
      [q.id, oldHash],
    );
    const nextQuote = await quote(
      f.wallId,
      f.slots[0]!.slotId,
      nextBuyer.token,
    );
    expect(
      (await reserve(nextQuote.id, nextBuyer.token, 'fresh-after-expiry-01'))
        .statusCode,
    ).toBe(201);
    expect(await count(f.slots[0]!.slotId)).toEqual({ active: 1, total: 2 });
    const old = await database.pool.query<{
      id: string;
      status: string;
      expired_at: Date | null;
    }>(
      'SELECT id, status, expired_at FROM takeover_reservations WHERE quote_id = $1::uuid',
      [q.id],
    );
    expect(old.rows[0]?.status).toBe('expired');
    expect(old.rows[0]?.expired_at).not.toBeNull();
    expect((await cancel(old.rows[0]!.id, buyer.token)).json().status).toBe(
      'expired',
    );
    const exactRetry = await reserve(q.id, buyer.token, oldKey);
    expect(exactRetry.statusCode).toBe(200);
    expect(exactRetry.json().status).toBe('expired');
    expect(
      (await reserve(q.id, buyer.token, 'old-quote-new-key-01')).json().error
        .code,
    ).toBe('QUOTE_ALREADY_RESERVED');
  });

  it('uses strict Quote and inclusive Reservation expiry at the exact PostgreSQL boundary', async () => {
    const f = await fixture();
    const buyer = await person();
    const source = await quote(f.wallId, f.slots[0]!.slotId, buyer.token);
    const boundary = new Date('2030-01-01T00:00:00.000Z');
    const fixed = await database.pool.query<{ id: string }>(
      `INSERT INTO takeover_quotes
         (user_id, wall_id, slot_id, target_placement_id, pricing_config_id,
          algorithm_version, currency, amount_minor, wall_takeover_count,
          last_takeover_at, step_index, ladder_amount_minor,
          decay_intervals_applied, quoted_at, expires_at)
       SELECT user_id, wall_id, slot_id, target_placement_id, pricing_config_id,
              algorithm_version, currency, amount_minor, wall_takeover_count,
              last_takeover_at, step_index, ladder_amount_minor,
              decay_intervals_applied, $2::timestamptz - interval '2 minutes',
              $2::timestamptz
       FROM takeover_quotes WHERE id = $1::uuid RETURNING id`,
      [source.id, boundary],
    );
    const quoteId = fixed.rows[0]!.id;
    const comparisons = await database.pool.query<{
      before: boolean;
      equal: boolean;
      after: boolean;
    }>(
      `SELECT expires_at > $2::timestamptz - interval '1 millisecond' AS before,
              expires_at > $2::timestamptz AS equal,
              expires_at > $2::timestamptz + interval '1 millisecond' AS after
       FROM takeover_quotes WHERE id = $1::uuid`,
      [quoteId, boundary],
    );
    expect(comparisons.rows[0]).toEqual({
      before: true,
      equal: false,
      after: false,
    });
    const inserted = await database.pool.query<{ id: string }>(
      `INSERT INTO takeover_reservations
         (quote_id, user_id, wall_id, slot_id, target_placement_id,
          pricing_config_id, currency, amount_minor, idempotency_key_hash,
          created_at, expires_at)
       SELECT id, user_id, wall_id, slot_id, target_placement_id,
              pricing_config_id, currency, amount_minor, repeat('c', 64),
              $2::timestamptz - interval '4 minutes', $2::timestamptz
       FROM takeover_quotes WHERE id = $1::uuid RETURNING id`,
      [quoteId, boundary],
    );
    const id = inserted.rows[0]!.id;
    const expireAt = (now: Date) =>
      database.pool.query(
        `UPDATE takeover_reservations
         SET status = 'expired', expired_at = $2::timestamptz
         WHERE id = $1::uuid AND status = 'active'
           AND expires_at <= $2::timestamptz`,
        [id, now],
      );
    expect((await expireAt(new Date(boundary.getTime() - 1))).rowCount).toBe(0);
    expect((await expireAt(boundary)).rowCount).toBe(1);
    expect((await read(id, buyer.token)).json().status).toBe('expired');
  });

  it('rejects expired Quote, stale target, paused Wall, and cooldown', async () => {
    const f = await fixture();
    const buyer = await person();
    const slot = f.slots[0]!;
    const expired = await quote(f.wallId, slot.slotId, buyer.token);
    // The Quote is append-only, so insert an expired copy with the same evidence.
    const past = await database.pool.query<{ id: string }>(
      `INSERT INTO takeover_quotes
         (user_id, wall_id, slot_id, target_placement_id, pricing_config_id,
          algorithm_version, currency, amount_minor, wall_takeover_count,
          last_takeover_at, step_index, ladder_amount_minor,
          decay_intervals_applied, quoted_at, expires_at)
       SELECT user_id, wall_id, slot_id, target_placement_id, pricing_config_id,
              algorithm_version, currency, amount_minor, wall_takeover_count,
              last_takeover_at, step_index, ladder_amount_minor,
              decay_intervals_applied, clock_timestamp() - interval '2 minutes',
              clock_timestamp() - interval '1 minute'
       FROM takeover_quotes WHERE id = $1::uuid RETURNING id`,
      [expired.id],
    );
    expect(
      (
        await reserve(past.rows[0]!.id, buyer.token, 'expired-quote-key-01')
      ).json().error.code,
    ).toBe('QUOTE_EXPIRED');

    await database.pool.query(
      `UPDATE walls SET status = 'paused' WHERE id = $1::uuid`,
      [f.wallId],
    );
    expect(
      (await reserve(expired.id, buyer.token, 'paused-wall-key-001')).json()
        .error.code,
    ).toBe('WALL_NOT_TAKEOVER_ELIGIBLE');
    await database.pool.query(
      `UPDATE walls SET status = 'live', end_at = clock_timestamp() - interval '1 second'
       WHERE id = $1::uuid`,
      [f.wallId],
    );
    expect(
      (await reserve(expired.id, buyer.token, 'ended-wall-key-0001')).json()
        .error.code,
    ).toBe('WALL_NOT_TAKEOVER_ELIGIBLE');
    await database.pool.query(
      `UPDATE walls SET end_at = NULL WHERE id = $1::uuid`,
      [f.wallId],
    );
    await database.pool.query(
      `UPDATE placements SET ended_at = clock_timestamp(), end_reason = 'test'
       WHERE id = $1::uuid`,
      [slot.placementId],
    );
    expect(
      (await reserve(expired.id, buyer.token, 'stale-target-key-001')).json()
        .error.code,
    ).toBe('QUOTE_TARGET_STALE');
    expect(await count(slot.slotId)).toEqual({ active: 0, total: 0 });

    const cooling = await fixture(1, 60, 10);
    const coolingBuyer = await person();
    const coolingQuote = await database.pool.query<{ id: string }>(
      `INSERT INTO takeover_quotes
         (user_id, wall_id, slot_id, target_placement_id, pricing_config_id,
          algorithm_version, currency, amount_minor, wall_takeover_count,
          last_takeover_at, step_index, ladder_amount_minor,
          decay_intervals_applied, quoted_at, expires_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
               'takeover_ladder_v1', 'RUB', 65000, 0, NULL, 0, 65000,
               0, clock_timestamp() - interval '30 seconds',
               clock_timestamp() + interval '90 seconds') RETURNING id`,
      [
        coolingBuyer.id,
        cooling.wallId,
        cooling.slots[0]!.slotId,
        cooling.slots[0]!.placementId,
        cooling.configId,
      ],
    );
    expect(
      (
        await reserve(
          coolingQuote.rows[0]!.id,
          coolingBuyer.token,
          'cooldown-quote-key-01',
        )
      ).json().error.code,
    ).toBe('TAKEOVER_COOLDOWN_ACTIVE');
  });

  it('fails closed on a Quote whose Slot and target Placement disagree', async () => {
    const f = await fixture(2);
    const buyer = await person();
    const valid = await quote(f.wallId, f.slots[0]!.slotId, buyer.token);
    const corrupt = await database.pool.query<{ id: string }>(
      `INSERT INTO takeover_quotes
         (user_id, wall_id, slot_id, target_placement_id, pricing_config_id,
          algorithm_version, currency, amount_minor, wall_takeover_count,
          last_takeover_at, step_index, ladder_amount_minor,
          decay_intervals_applied, quoted_at, expires_at)
       SELECT user_id, wall_id, $2::uuid, target_placement_id, pricing_config_id,
              algorithm_version, currency, amount_minor, wall_takeover_count,
              last_takeover_at, step_index, ladder_amount_minor,
              decay_intervals_applied, quoted_at, expires_at
       FROM takeover_quotes WHERE id = $1::uuid RETURNING id`,
      [valid.id, f.slots[1]!.slotId],
    );
    const response = await reserve(
      corrupt.rows[0]!.id,
      buyer.token,
      'bad-quote-structure-01',
    );
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('INVALID_QUOTE_STATE');
    expect(await count(f.slots[1]!.slotId)).toEqual({ active: 0, total: 0 });
  });

  it('allows only one live reservation across Slots, Walls and repository instances', async () => {
    const f = await fixture(10);
    const otherWall = await fixture();
    const buyer = await person();
    const targets = [
      ...f.slots.map((slot) => ({ wallId: f.wallId, slotId: slot.slotId })),
      { wallId: otherWall.wallId, slotId: otherWall.slots[0]!.slotId },
    ];
    const quotes = await Promise.all(
      targets.map((t) => quote(t.wallId, t.slotId, buyer.token)),
    );
    // Separate repositories represent independent API instances/pools.
    const secondDatabase = createDatabase(url!);
    const services = [database, secondDatabase].map(
      (db) =>
        new TakeoverReservationService(
          createPgTakeoverReservationRepository(db.pool),
        ),
    );
    try {
      const outcomes = await Promise.allSettled(
        quotes.map((q, index) =>
          services[index % 2]!.create(
            index % 2 ? buyer.id.toUpperCase() : buyer.id,
            q.id,
            `admission-concurrent-${index}`,
          ),
        ),
      );
      expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = outcomes.filter((r) => r.status === 'rejected');
      expect(rejected).toHaveLength(10);
      for (const result of rejected) {
        if (result.status === 'rejected') {
          expect(result.reason).toMatchObject({
            code: 'USER_RESERVATION_ACTIVE',
          });
        }
      }
      const winner = outcomes.find((r) => r.status === 'fulfilled');
      if (!winner || winner.status !== 'fulfilled')
        throw new Error('No winner');
      const blockedQuote = quotes.find(
        (q) => q.id !== winner.value.reservation.quoteId,
      )!;
      const blocked = await reserve(
        blockedQuote.id,
        buyer.token,
        'blocked-new-attempt-01',
      );
      expect(blocked.statusCode).toBe(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect(blocked.headers['cache-control']).toBe('no-store');
      await cancel(winner.value.reservation.id, buyer.token);
      expect(
        (await reserve(blockedQuote.id, buyer.token, 'blocked-new-attempt-01'))
          .statusCode,
      ).toBe(201);
    } finally {
      await secondDatabase.close();
    }
  });

  it('counts cancelled reservations toward velocity, preserves replay and isolates users', async () => {
    const f = await fixture(2);
    const buyer = await person();
    let last!: { quoteId: string; id: string; key: string };
    for (let index = 0; index < 5; index++) {
      const q = await quote(f.wallId, f.slots[0]!.slotId, buyer.token);
      const key = `velocity-reservation-${index}`;
      const created = await reserve(q.id, buyer.token, key);
      expect(created.statusCode).toBe(201);
      last = { quoteId: q.id, id: created.json().id, key };
      expect((await cancel(last.id, buyer.token)).statusCode).toBe(200);
    }
    const next = await quote(f.wallId, f.slots[0]!.slotId, buyer.token);
    const blocked = await reserve(
      next.id,
      buyer.token,
      'velocity-blocked-attempt',
    );
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('RESERVATION_RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(60);
    const replay = await reserve(last.quoteId, buyer.token, last.key);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ id: last.id, status: 'cancelled' });
    expect(
      (await reserve(next.id, buyer.token, last.key)).json().error.code,
    ).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((await read(last.id, buyer.token)).statusCode).toBe(200);
    expect((await cancel(last.id, buyer.token)).statusCode).toBe(200);
    const another = await person();
    const independent = await quote(
      f.wallId,
      f.slots[1]!.slotId,
      another.token,
    );
    expect(
      (await reserve(independent.id, another.token, 'other-user-reservation'))
        .statusCode,
    ).toBe(201);
    expect(await count(f.slots[0]!.slotId)).toEqual({ active: 0, total: 5 });
  });

  it('ignores effectively expired reservations without a cleanup/read and replays after Wall changes', async () => {
    const f = await fixture(2);
    const buyer = await person();
    const q = await quote(f.wallId, f.slots[0]!.slotId, buyer.token);
    // Seed immutable historical evidence; no production clock override.
    const past = await database.pool.query<{ id: string }>(
      `INSERT INTO takeover_reservations
         (quote_id, user_id, wall_id, slot_id, target_placement_id,
          pricing_config_id, currency, amount_minor, idempotency_key_hash,
          created_at, expires_at)
       SELECT id, user_id, wall_id, slot_id, target_placement_id,
              pricing_config_id, currency, amount_minor, $2,
              clock_timestamp() - interval '5 minutes',
              clock_timestamp() - interval '1 minute'
       FROM takeover_quotes WHERE id = $1::uuid RETURNING id`,
      [
        q.id,
        createHash('sha256').update('historical-replay-key').digest('hex'),
      ],
    );
    const next = await quote(f.wallId, f.slots[1]!.slotId, buyer.token);
    expect(
      (await reserve(next.id, buyer.token, 'after-expiry-new-attempt'))
        .statusCode,
    ).toBe(201);
    await database.pool.query(
      "UPDATE walls SET status = 'paused' WHERE id = $1::uuid",
      [f.wallId],
    );
    const replay = await reserve(q.id, buyer.token, 'historical-replay-key');
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      id: past.rows[0]!.id,
      status: 'expired',
    });
  });

  it('restores velocity budget when historical reservations leave the rolling window', async () => {
    const f = await fixture(6);
    const buyer = await person();
    for (let index = 0; index < 5; index++) {
      const q = await quote(f.wallId, f.slots[index]!.slotId, buyer.token);
      const inserted = await database.pool.query<{ id: string }>(
        `INSERT INTO takeover_reservations
           (quote_id, user_id, wall_id, slot_id, target_placement_id,
            pricing_config_id, currency, amount_minor, idempotency_key_hash,
            created_at, expires_at)
         SELECT id, user_id, wall_id, slot_id, target_placement_id,
                pricing_config_id, currency, amount_minor, $2,
                clock_timestamp() - interval '61 seconds',
                clock_timestamp() - interval '1 second'
         FROM takeover_quotes WHERE id = $1::uuid RETURNING id`,
        [
          q.id,
          createHash('sha256').update(`old-velocity-${index}`).digest('hex'),
        ],
      );
      expect(
        (await read(inserted.rows[0]!.id, buyer.token)).json().status,
      ).toBe('expired');
    }
    const q = await quote(f.wallId, f.slots[5]!.slotId, buyer.token);
    expect(
      (await reserve(q.id, buyer.token, 'new-window-reservation')).statusCode,
    ).toBe(201);
  });

  it('serializes 50 buyers for one Slot', async () => {
    const f = await fixture();
    const slotId = f.slots[0]!.slotId;
    const buyers = await Promise.all(
      Array.from({ length: 50 }, () => person()),
    );
    const quotes = await Promise.all(
      buyers.map((b) => quote(f.wallId, slotId, b.token)),
    );
    const outcomes = await Promise.all(
      buyers.map((b, index) =>
        reserve(
          quotes[index]!.id,
          b.token,
          `buyer-key-${String(index).padStart(12, '0')}`,
        ),
      ),
    );
    expect(outcomes.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(
      outcomes.filter((r) => r.json().error?.code === 'SLOT_RESERVED'),
    ).toHaveLength(49);
    expect(await count(slotId)).toEqual({ active: 1, total: 1 });
  }, 30_000);

  it('serializes many identical retries and same-key different-Quote races', async () => {
    const f = await fixture(3);
    const buyer = await person();
    const first = await quote(f.wallId, f.slots[0]!.slotId, buyer.token);
    const retries = await Promise.all(
      Array.from({ length: 25 }, () =>
        reserve(first.id, buyer.token, 'identical-retry-key-01'),
      ),
    );
    expect(retries.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(retries.filter((r) => r.statusCode === 200)).toHaveLength(24);
    expect(new Set(retries.map((r) => r.json().id)).size).toBe(1);
    await cancel(retries[0]!.json().id, buyer.token);
    const q1 = await quote(f.wallId, f.slots[1]!.slotId, buyer.token);
    const q2 = await quote(f.wallId, f.slots[2]!.slotId, buyer.token);
    const [a, b] = await Promise.all([
      reserve(q1.id, buyer.token, 'same-key-two-quotes-01'),
      reserve(q2.id, buyer.token, 'same-key-two-quotes-01'),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    expect([a.json().error?.code, b.json().error?.code]).toContain(
      'IDEMPOTENCY_KEY_REUSED',
    );
    const total = await database.pool.query<{ count: string }>(
      `SELECT count(*) FROM takeover_reservations
       WHERE quote_id IN ($1::uuid, $2::uuid)`,
      [q1.id, q2.id],
    );
    expect(total.rows[0]?.count).toBe('1');
  }, 30_000);

  it('waits for a target replacement and a Wall pause, then fails closed', async () => {
    const f = await fixture();
    const buyer = await person();
    const slot = f.slots[0]!;
    const q = await quote(f.wallId, slot.slotId, buyer.token);
    const actor = await database.pool.connect();
    try {
      await actor.query('BEGIN');
      await actor.query('SELECT id FROM slots WHERE id = $1::uuid FOR UPDATE', [
        slot.slotId,
      ]);
      await actor.query(
        `UPDATE placements SET ended_at = clock_timestamp(), end_reason = 'replaced'
         WHERE id = $1::uuid`,
        [slot.placementId],
      );
      const waiting = reserve(q.id, buyer.token, 'target-race-key-0001');
      await waitForLock('FROM slots WHERE id');
      await actor.query('COMMIT');
      expect((await waiting).json().error.code).toBe('QUOTE_TARGET_STALE');
    } finally {
      await actor.query('ROLLBACK').catch(() => undefined);
      actor.release();
    }
    expect(await count(slot.slotId)).toEqual({ active: 0, total: 0 });

    const another = await fixture();
    const buyer2 = await person();
    const q2 = await quote(
      another.wallId,
      another.slots[0]!.slotId,
      buyer2.token,
    );
    const lifecycle = await database.pool.connect();
    try {
      await lifecycle.query('BEGIN');
      await lifecycle.query(
        `UPDATE walls SET status = 'paused' WHERE id = $1::uuid`,
        [another.wallId],
      );
      const waiting = reserve(q2.id, buyer2.token, 'wall-race-key-00001');
      await waitForLock('FROM walls');
      await lifecycle.query('COMMIT');
      expect((await waiting).json().error.code).toBe(
        'WALL_NOT_TAKEOVER_ELIGIBLE',
      );
    } finally {
      await lifecycle.query('ROLLBACK').catch(() => undefined);
      lifecycle.release();
    }
    expect(await count(another.slots[0]!.slotId)).toEqual({
      active: 0,
      total: 0,
    });
  }, 30_000);

  it('holds Slot and Wall locks until Reservation commits before competing writers', async () => {
    const f = await fixture();
    const buyer = await person();
    const q = await quote(f.wallId, f.slots[0]!.slotId, buyer.token);
    let entered!: () => void;
    let release!: () => void;
    const atSlot = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const continueReservation = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holding = new TakeoverReservationService(
      createPgTakeoverReservationRepository(database.pool, {
        afterSlotLock: async () => {
          entered();
          await continueReservation;
        },
      }),
    );
    const reserved = holding.create(buyer.id, q.id, 'reservation-first-01');
    try {
      await atSlot;
      const replacement = (async () => {
        const client = await database.pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            'SELECT id FROM slots WHERE id = $1::uuid FOR UPDATE',
            [f.slots[0]!.slotId],
          );
          const active = await client.query(
            `SELECT 1 FROM takeover_reservations
             WHERE slot_id = $1::uuid AND status = 'active'`,
            [f.slots[0]!.slotId],
          );
          if (!active.rowCount) {
            await client.query(
              `UPDATE placements SET ended_at = clock_timestamp(), end_reason = 'replaced'
               WHERE id = $1::uuid`,
              [f.slots[0]!.placementId],
            );
          }
          await client.query('COMMIT');
          return active.rowCount;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      })();
      await waitForLock('FROM slots WHERE id');
      release();
      expect((await reserved).reservation.status).toBe('active');
      expect(await replacement).toBe(1);
      const target = await database.pool.query<{ ended_at: Date | null }>(
        'SELECT ended_at FROM placements WHERE id = $1::uuid',
        [f.slots[0]!.placementId],
      );
      expect(target.rows[0]?.ended_at).toBeNull();
    } finally {
      release();
    }

    const second = await fixture();
    const buyer2 = await person();
    const q2 = await quote(
      second.wallId,
      second.slots[0]!.slotId,
      buyer2.token,
    );
    let entered2!: () => void;
    let release2!: () => void;
    const atSlot2 = new Promise<void>((resolve) => {
      entered2 = resolve;
    });
    const continue2 = new Promise<void>((resolve) => {
      release2 = resolve;
    });
    const holding2 = new TakeoverReservationService(
      createPgTakeoverReservationRepository(database.pool, {
        afterSlotLock: async () => {
          entered2();
          await continue2;
        },
      }),
    );
    const reserved2 = holding2.create(
      buyer2.id,
      q2.id,
      'wall-pause-after-reservation-01',
    );
    try {
      await atSlot2;
      const pause = database.pool.query(
        `UPDATE walls SET status = 'paused' WHERE id = $1::uuid`,
        [second.wallId],
      );
      await waitForLock('UPDATE walls');
      release2();
      expect((await reserved2).reservation.status).toBe('active');
      await pause;
      const state = await database.pool.query<{ status: string }>(
        'SELECT status FROM walls WHERE id = $1::uuid',
        [second.wallId],
      );
      expect(state.rows[0]?.status).toBe('paused');
    } finally {
      release2();
    }
  }, 30_000);
});
