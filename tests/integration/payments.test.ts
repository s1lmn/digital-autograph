import { randomUUID, createHash } from 'node:crypto';
import { beforeEach, afterAll, it, expect } from 'vitest';
import { createYookassaProvider } from '../../packages/integrations/src/yookassa';
import { buildApi } from '../../apps/api/src/app';
import { SessionService } from '../../packages/auth/src/index';
import {
  createDatabase,
  createPgPaymentRepository,
  createPgPricingRepository,
  createPgTakeoverReservationRepository,
  createPgSessionRepository,
} from '../../packages/db/src/index';
import {
  TakeoverQuoteService,
  TakeoverReservationService,
} from '../../packages/walls/src/index';
import {
  PaymentService,
  PaymentError,
  type PaymentObservation,
  type PaymentProvider,
  type PaymentSettings,
} from '../../packages/payments/src/index';
const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/autograph_test')
  throw new Error('Payments require isolated autograph_test');
const database = createDatabase(url);
const sessions = new SessionService(
  createPgSessionRepository(database.pool),
  1209600,
);
const settings: PaymentSettings = {
  shopId: '123',
  mode: 'sandbox',
  returnUrl: 'https://example.test/payments/return',
  creatorShareBps: 5000,
};
const store = new Map<string, PaymentObservation>();
const keys = new Map<string, string>();
let createUnknown = false;
let creates = 0;
const provider: PaymentProvider = {
  async createPayment(p, key) {
    creates++;
    const id = keys.get(key) ?? randomUUID();
    keys.set(key, id);
    if (!store.has(id))
      store.set(id, {
        id,
        orderId: p.orderId,
        shopId: '123',
        test: true,
        amountMinor: p.amountMinor,
        currency: 'RUB',
        rawStatus: 'pending',
        paid: false,
        confirmationUrl:
          'https://yoomoney.ru/checkout/payments/v2/contract?orderId=fixture',
      });
    if (createUnknown) throw new PaymentError('PROVIDER_OUTCOME_UNKNOWN');
    return store.get(id)!;
  },
  async getPayment(id) {
    const p = store.get(id);
    if (!p) throw new PaymentError('PROVIDER_REJECTED');
    return { ...p };
  },
};
const repo = createPgPaymentRepository(database.pool);
function service(repository = repo) {
  return new PaymentService(repository, provider, settings);
}
function api(payments = service()) {
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
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    payments,
  );
}
async function person() {
  const id = randomUUID();
  await database.pool.query('INSERT INTO users (id) VALUES ($1::uuid)', [id]);
  return { id, token: (await sessions.createSession(id)).token };
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

async function setup(shortTtlSeconds?: number, visibilitySeconds = 0) {
  const f = await fixture(1, visibilitySeconds);
  const buyer = await person();
  const autographId = await autographFixture(buyer.id);
  const q = await new TakeoverQuoteService(
    createPgPricingRepository(database.pool),
  ).createQuote({
    userId: buyer.id,
    wallId: f.wallId,
    slotId: f.slots[0]!.slotId,
  });
  const reservation = shortTtlSeconds
    ? await createPgTakeoverReservationRepository(database.pool).create({
        userId: buyer.id,
        quoteId: q.id,
        idempotencyKeyHash: createHash('sha256')
          .update(randomUUID())
          .digest('hex'),
        ttlSeconds: shortTtlSeconds,
      })
    : await new TakeoverReservationService(
        createPgTakeoverReservationRepository(database.pool),
      ).create(buyer.id, q.id, randomUUID());
  return {
    ...f,
    buyer,
    autographId,
    reservationId: reservation.reservation.id,
  };
}
async function started() {
  const f = await setup();
  const result = await service().create(
    f.buyer.id,
    f.reservationId,
    f.autographId,
  );
  const attempt = (await repo.find(result.id))!;
  return { ...f, orderId: result.id, providerId: attempt.providerPaymentId! };
}
function succeed(id: string) {
  const p = store.get(id)!;
  store.set(id, {
    ...p,
    rawStatus: 'succeeded',
    paid: true,
    confirmationUrl: null,
  });
}
async function counts(orderId: string) {
  return (
    await database.pool.query(
      `SELECT o.status,o.placement_id,(SELECT count(*)::int FROM placements WHERE slot_id=o.slot_id AND source='takeover') AS takeovers,(SELECT count(*)::int FROM creator_earnings WHERE order_id=o.id) AS earnings,(SELECT count(*)::int FROM placements WHERE slot_id=o.slot_id AND ended_at IS NULL) AS active FROM payment_orders o WHERE o.id=$1`,
      [orderId],
    )
  ).rows[0];
}
beforeEach(async () => {
  await database.pool.query('TRUNCATE users CASCADE');
  store.clear();
  keys.clear();
  createUnknown = false;
  creates = 0;
});
afterAll(() => database.close());
it('success atomically preserves history, earns once, consumes reservation and pins price', async () => {
  const f = await started();
  succeed(f.providerId);
  await service().webhook(f.providerId, 'payment.succeeded');
  expect(await counts(f.orderId)).toMatchObject({
    status: 'fulfilled',
    takeovers: 1,
    earnings: 1,
    active: 1,
  });
  const r = await database.pool.query(
    'SELECT status FROM takeover_reservations WHERE id=$1',
    [f.reservationId],
  );
  expect(r.rows[0].status).toBe('consumed');
  const e = await database.pool.query(
    'SELECT amount_minor,gross_amount_minor FROM creator_earnings WHERE order_id=$1',
    [f.orderId],
  );
  expect(BigInt(e.rows[0].amount_minor)).toBe(
    BigInt(e.rows[0].gross_amount_minor) / 2n,
  );
  expect(
    (
      await database.pool.query(
        'SELECT end_reason FROM placements WHERE id=$1',
        [f.slots[0]!.placementId],
      )
    ).rows[0].end_reason,
  ).toBe('takeover');
});
it('50 duplicate handlers across instances plus reconciliation fulfill exactly once', async () => {
  const f = await started();
  succeed(f.providerId);
  const other = createDatabase(url!);
  try {
    const s2 = service(createPgPaymentRepository(other.pool));
    await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) =>
        i % 3 === 0
          ? s2.progress(f.orderId)
          : service().webhook(f.providerId, 'payment.succeeded'),
      ),
    );
    await s2.reconcile();
    await service().webhook(f.providerId, 'payment.succeeded');
    expect(await counts(f.orderId)).toMatchObject({
      status: 'fulfilled',
      takeovers: 1,
      earnings: 1,
      active: 1,
    });
    expect(
      (
        await database.pool.query(
          'SELECT count(*)::int AS n FROM payment_event_receipts WHERE provider_payment_id=$1',
          [f.providerId],
        )
      ).rows[0].n,
    ).toBe(1);
    const outbox = await database.pool.query<{ kind: string; n: number }>(
      `SELECT kind,count(*)::int n FROM notification_events
       WHERE source_key=$1 OR source_key=$2 OR source_key=$3 GROUP BY kind ORDER BY kind`,
      [
        `payment:${f.orderId}:fulfilled`,
        `displaced:${f.slots[0]!.placementId}`,
        `claim:${(await repo.find(f.orderId))!.placementId}`,
      ],
    );
    expect(outbox.rows).toEqual([
      { kind: 'payment_status', n: 1 },
      { kind: 'slot_claimed', n: 1 },
      { kind: 'user_displaced', n: 1 },
    ]);
  } finally {
    await other.close();
  }
});
it('unknown create survives restart and reuses the exact key', async () => {
  const f = await setup();
  createUnknown = true;
  const o = await service().create(f.buyer.id, f.reservationId, f.autographId);
  expect(o.status).toBe('unknown');
  createUnknown = false;
  await service().progress(o.id);
  expect(keys.size).toBe(1);
  expect(creates).toBe(2);
  expect((await repo.find(o.id))?.state).toBe('provider_pending');
});
it('does not retry create outside provider retention', async () => {
  const f = await setup();
  createUnknown = true;
  const o = await service().create(f.buyer.id, f.reservationId, f.autographId);
  // Repository projects the retry deadline from PostgreSQL clock_timestamp,
  // not a potentially skewed application clock. Exercise the elapsed projection.
  await service({
    ...repo,
    find: async (id) => {
      const p = await repo.find(id);
      return p ? { ...p, createRetryAllowed: false } : null;
    },
  }).progress(o.id);
  expect(creates).toBe(1);
  expect((await repo.find(o.id))?.reason).toBe(
    'CREATE_UNKNOWN_REQUIRES_MANUAL_REVIEW',
  );
});
it('same reservation returns same order and rejects changed autograph', async () => {
  const f = await started();
  const again = await service().create(
    f.buyer.id,
    f.reservationId,
    f.autographId,
  );
  expect(again.id).toBe(f.orderId);
  expect(creates).toBe(1);
  await expect(
    service().create(f.buyer.id, f.reservationId, randomUUID()),
  ).rejects.toThrow('ORDER_REQUEST_CONFLICT');
});
it.each([
  'cancelled',
  'expired',
  'slot_changed',
  'wall_ended',
  'autograph_hidden',
])('late success %s never takes over', async (reason) => {
  const f = await started();
  if (reason === 'cancelled')
    await new TakeoverReservationService(
      createPgTakeoverReservationRepository(database.pool),
    ).cancelOwned(f.buyer.id, f.reservationId);
  if (reason === 'expired')
    await database.pool.query(
      "UPDATE takeover_reservations SET status='expired',expired_at=clock_timestamp() WHERE id=$1",
      [f.reservationId],
    );
  if (reason === 'slot_changed')
    await database.pool.query(
      "UPDATE placements SET ended_at=clock_timestamp(),end_reason='admin' WHERE id=$1",
      [f.slots[0]!.placementId],
    );
  if (reason === 'wall_ended')
    await database.pool.query("UPDATE walls SET status='ended' WHERE id=$1", [
      f.wallId,
    ]);
  if (reason === 'autograph_hidden')
    await database.pool.query(
      "UPDATE autographs SET status='moderation_rejected' WHERE id=$1",
      [f.autographId],
    );
  succeed(f.providerId);
  await service().webhook(f.providerId, 'payment.succeeded');
  expect(await counts(f.orderId)).toMatchObject({
    status: 'paid_but_not_fulfilled',
    takeovers: 0,
    earnings: 0,
  });
  expect((await service().reconcile()).attention).toBeGreaterThan(0);
});
it('transaction fault rolls back old placement, new placement, earning, order; retry repairs', async () => {
  const f = await started();
  succeed(f.providerId);
  const bad = service(
    createPgPaymentRepository(database.pool, {
      afterPlacementInsert: async () => {
        throw new Error('simulated crash');
      },
    }),
  );
  await expect(
    bad.webhook(f.providerId, 'payment.succeeded'),
  ).rejects.toThrow();
  expect(await counts(f.orderId)).toMatchObject({
    status: 'unknown',
    takeovers: 0,
    earnings: 0,
    active: 1,
  });
  await service().progress(f.orderId);
  expect(await counts(f.orderId)).toMatchObject({
    status: 'fulfilled',
    takeovers: 1,
    earnings: 1,
  });
});
it.each([
  { amountMinor: '1' },
  { currency: 'USD' },
  { shopId: 'other' },
  { test: false },
  { orderId: '00000000-0000-4000-8000-000000000001' },
  { rawStatus: 'new_status' },
])('fails closed on authenticated mismatch %j', async (patch) => {
  const f = await started();
  succeed(f.providerId);
  store.set(f.providerId, { ...store.get(f.providerId)!, ...patch });
  await service().progress(f.orderId);
  expect(await counts(f.orderId)).toMatchObject({
    status: 'unknown',
    takeovers: 0,
    earnings: 0,
  });
  expect((await repo.find(f.orderId))?.reason).toBeTruthy();
});
it('waiting_for_capture is not success and stale bodies cannot change final state', async () => {
  const f = await started();
  store.set(f.providerId, {
    ...store.get(f.providerId)!,
    rawStatus: 'waiting_for_capture',
    paid: true,
  });
  await service().webhook(f.providerId, 'payment.succeeded');
  expect(await counts(f.orderId)).toMatchObject({ takeovers: 0 });
  succeed(f.providerId);
  await service().webhook(f.providerId, 'payment.canceled');
  expect(await counts(f.orderId)).toMatchObject({
    status: 'fulfilled',
    takeovers: 1,
  });
  await service().webhook(f.providerId, 'payment.waiting_for_capture');
  expect(await counts(f.orderId)).toMatchObject({ takeovers: 1, earnings: 1 });
});
it('canceled then contradictory success requires manual review', async () => {
  const f = await started();
  store.set(f.providerId, {
    ...store.get(f.providerId)!,
    rawStatus: 'canceled',
  });
  await service().progress(f.orderId);
  succeed(f.providerId);
  await service().progress(f.orderId);
  expect(await counts(f.orderId)).toMatchObject({
    status: 'paid_but_not_fulfilled',
    takeovers: 0,
  });
});
it('DB rejects mutable snapshots, duplicate bindings, missing earnings, and duplicate earning', async () => {
  const f = await started();
  succeed(f.providerId);
  await service().progress(f.orderId);
  for (const query of [
    'UPDATE payment_orders SET amount_minor=1 WHERE id=$1',
    "UPDATE payment_orders SET status='created',placement_id=NULL,fulfilled_at=NULL WHERE id=$1",
    'UPDATE payments SET operation_key=gen_random_uuid() WHERE order_id=$1',
    'UPDATE creator_earnings SET amount_minor=0 WHERE order_id=$1',
    'DELETE FROM creator_earnings WHERE order_id=$1',
  ]) {
    await expect(database.pool.query(query, [f.orderId])).rejects.toThrow();
  }
  await expect(
    database.pool.query(
      'INSERT INTO creator_earnings SELECT gen_random_uuid(),order_id,payment_id,placement_id,creator_id,gross_amount_minor,amount_minor,share_bps,currency,created_at FROM creator_earnings',
    ),
  ).rejects.toThrow();
  const g = await started();
  await expect(
    database.pool.query(
      'UPDATE payments SET provider_payment_id=$2 WHERE order_id=$1',
      [g.orderId, f.providerId],
    ),
  ).rejects.toThrow();
});
it('API requires ownership, rejects client price/return URL and does not trust webhook body', async () => {
  const f = await started(),
    stranger = await person();
  const app = api();
  try {
    const headers = {
      cookie: `da_session=${stranger.token}`,
      origin: 'http://127.0.0.1:3000',
    };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/payments/orders',
          payload: {
            reservationId: f.reservationId,
            autographId: f.autographId,
          },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/payments/orders',
          headers,
          payload: {
            reservationId: f.reservationId,
            autographId: f.autographId,
          },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/payments/orders/${f.orderId}`,
          headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/payments/orders/${f.orderId}/refresh`,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/payments/orders',
          headers,
          payload: {
            reservationId: f.reservationId,
            autographId: f.autographId,
            amountMinor: '1',
          },
        })
      ).statusCode,
    ).toBe(400);
    const spoof = await app.inject({
      method: 'POST',
      url: '/payments/webhooks/yookassa',
      payload: {
        type: 'notification',
        event: 'payment.succeeded',
        object: {
          id: f.providerId,
          status: 'succeeded',
          paid: true,
          amount: { value: '999.99' },
        },
      },
    });
    expect(spoof.statusCode).toBe(200);
    expect(await counts(f.orderId)).toMatchObject({ takeovers: 0 });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/payments/webhooks/yookassa',
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/payments/webhooks/yookassa',
          payload: { padding: 'x'.repeat(17000) },
        })
      ).statusCode,
    ).toBe(413);
  } finally {
    await app.close();
  }
});

it('concurrent creates persist one attempt/key before any provider request', async () => {
  const f = await setup();
  const results = await Promise.all(
    Array.from({ length: 20 }, () =>
      service().create(f.buyer.id, f.reservationId, f.autographId),
    ),
  );
  expect(new Set(results.map((r) => r.id)).size).toBe(1);
  expect(keys.size).toBe(1);
  expect(
    (await database.pool.query('SELECT count(*)::int AS n FROM payments'))
      .rows[0].n,
  ).toBe(1);
});
it('cancel racing fulfillment serializes on Slot; either outcome remains atomic', async () => {
  const f = await started();
  succeed(f.providerId);
  await Promise.allSettled([
    service().webhook(f.providerId, 'payment.succeeded'),
    new TakeoverReservationService(
      createPgTakeoverReservationRepository(database.pool),
    ).cancelOwned(f.buyer.id, f.reservationId),
  ]);
  const c = await counts(f.orderId);
  expect(['fulfilled', 'paid_but_not_fulfilled']).toContain(c.status);
  expect(c.earnings).toBe(c.takeovers);
  expect(c.active).toBe(1);
});
it('an expired I/O lease can be recovered after process restart', async () => {
  const f = await started();
  const token = await repo.lease(f.orderId);
  expect(token).toBeTruthy();
  await database.pool.query(
    "UPDATE payments SET lease_until=clock_timestamp()-interval '1 second' WHERE order_id=$1",
    [f.orderId],
  );
  succeed(f.providerId);
  await service().progress(f.orderId);
  expect(await counts(f.orderId)).toMatchObject({
    status: 'fulfilled',
    takeovers: 1,
  });
  await expect(
    repo.observe(f.orderId, token!, store.get(f.providerId)!),
  ).rejects.toThrow('PAYMENT_LEASE_LOST');
});
it('fulfilled without a verified payment and earning is rejected by deferred DB invariant', async () => {
  const f = await started();
  await expect(
    database.pool.query(
      "UPDATE payment_orders SET status='fulfilled',placement_id=target_placement_id,fulfilled_at=clock_timestamp() WHERE id=$1",
      [f.orderId],
    ),
  ).rejects.toThrow();
  expect(await counts(f.orderId)).toMatchObject({
    status: 'provider_pending',
    takeovers: 0,
    earnings: 0,
  });
});
it('cannot initialize payment using another owner autograph', async () => {
  const f = await setup(),
    other = await person();
  const autograph = await autographFixture(other.id);
  await expect(
    service().create(f.buyer.id, f.reservationId, autograph),
  ).rejects.toThrow('RESERVATION_NOT_ELIGIBLE');
  expect(creates).toBe(0);
});
it('unknown provider object is acknowledged without local mutation', async () => {
  const external = randomUUID();
  store.set(external, {
    id: external,
    orderId: randomUUID(),
    shopId: '123',
    test: true,
    amountMinor: '100',
    currency: 'RUB',
    rawStatus: 'succeeded',
    paid: true,
    confirmationUrl: null,
  });
  await service().webhook(external, 'payment.succeeded');
  expect(
    (await database.pool.query('SELECT count(*)::int AS n FROM payments'))
      .rows[0].n,
  ).toBe(0);
});

it.each([
  { amountMinor: '1' },
  { currency: 'USD' },
  { shopId: 'other' },
  { test: false },
])('webhook mismatch %j is audited without takeover', async (patch) => {
  const f = await started();
  succeed(f.providerId);
  store.set(f.providerId, { ...store.get(f.providerId)!, ...patch });
  await expect(
    service().webhook(f.providerId, 'payment.succeeded'),
  ).rejects.toThrow('UNVERIFIED_PAYMENT');
  expect(await counts(f.orderId)).toMatchObject({
    status: 'unknown',
    takeovers: 0,
    earnings: 0,
  });
  expect(
    (
      await database.pool.query(
        'SELECT result FROM payment_event_receipts WHERE provider_payment_id=$1',
        [f.providerId],
      )
    ).rows[0].result,
  ).toContain('MISMATCH');
});
it('JSON parser does not return raw provider body fragments', async () => {
  const app = api();
  try {
    const r = await app.inject({
      method: 'POST',
      url: '/payments/webhooks/yookassa',
      headers: { 'content-type': 'application/json' },
      payload: 'sensitive_customer_fixture{',
    });
    expect(r.statusCode).toBe(400);
    expect(r.body).not.toContain('sensitive_customer_fixture');
  } finally {
    await app.close();
  }
});

it('samples expiry after a real Wall lock wait, not before starting the transaction', async () => {
  const f = await setup(2);
  const o = await service().create(f.buyer.id, f.reservationId, f.autographId);
  const p = (await repo.find(o.id))!;
  succeed(p.providerPaymentId!);
  const blocker = await database.pool.connect();
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM walls WHERE id=$1 FOR UPDATE', [
      f.wallId,
    ]);
    const processing = service().progress(o.id);
    await blocker.query('SELECT pg_sleep(2.1)');
    await blocker.query('COMMIT');
    await processing;
    expect(await counts(o.id)).toMatchObject({
      status: 'paid_but_not_fulfilled',
      takeovers: 0,
      earnings: 0,
      active: 1,
    });
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
});

it.each([
  [
    'cancelled',
    'cancelled_at=clock_timestamp(), consumed_at=clock_timestamp()',
  ],
  ['expired', 'expired_at=clock_timestamp(), consumed_at=clock_timestamp()'],
  ['consumed', 'consumed_at=clock_timestamp(), cancelled_at=clock_timestamp()'],
  ['consumed', 'consumed_at=clock_timestamp(), expired_at=clock_timestamp()'],
])(
  'PostgreSQL rejects overlapping Reservation lifecycle: %s / %s',
  async (status, timestamps) => {
    const f = await setup();
    await expect(
      database.pool.query(
        `UPDATE takeover_reservations SET status=$2, ${timestamps} WHERE id=$1`,
        [f.reservationId, status],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'takeover_reservations_state_valid',
    });
    expect(
      (
        await database.pool.query(
          'SELECT status FROM takeover_reservations WHERE id=$1',
          [f.reservationId],
        )
      ).rows[0].status,
    ).toBe('active');
  },
);
it.each([400, 401, 403, 404, 422])(
  'deterministic create HTTP %s remains audited without repeated create or reconciliation',
  async (status) => {
    const f = await setup();
    let calls = 0;
    const rejected = createYookassaProvider(
      { shopId: settings.shopId, secretKey: 'test_fixture_not_real' },
      {
        fetch: async () => {
          calls++;
          return new Response('sensitive provider body', { status });
        },
      },
    );
    const s = new PaymentService(repo, rejected, settings);
    const order = await s.create(f.buyer.id, f.reservationId, f.autographId);
    expect((await repo.find(order.id))?.reason).toBe('PROVIDER_REJECTED');
    // Even an elapsed create window must not overwrite the retained rejection reason.
    const elapsed = new PaymentService(
      {
        ...repo,
        find: async (id) => {
          const p = await repo.find(id);
          return p ? { ...p, createRetryAllowed: false } : null;
        },
      },
      rejected,
      settings,
    );
    await elapsed.progress(order.id);
    await s.create(f.buyer.id, f.reservationId, f.autographId);
    await s.refresh(f.buyer.id, order.id);
    await database.pool.query(
      "UPDATE payments SET next_check_at=clock_timestamp()-interval '1 minute' WHERE order_id=$1",
      [order.id],
    );
    expect(await repo.due(50)).not.toContain(order.id);
    expect(await s.reconcile()).toMatchObject({ processed: 0, attention: 1 });
    expect(await repo.anomalies()).toContainEqual({
      orderId: order.id,
      reason: 'PROVIDER_REJECTED',
    });
    expect((await repo.find(order.id))?.reason).toBe('PROVIDER_REJECTED');
    expect(calls).toBe(1);
    expect(await counts(order.id)).toMatchObject({
      takeovers: 0,
      earnings: 0,
      active: 1,
    });
  },
);
it.each([408, 429, 500, 503])(
  'ambiguous create HTTP %s stays due and retries only the same key/payload',
  async (status) => {
    const f = await setup();
    const requests: Array<{ key: string; body: string }> = [];
    const ambiguous = createYookassaProvider(
      { shopId: settings.shopId, secretKey: 'test_fixture_not_real' },
      {
        fetch: async (_url, options) => {
          requests.push({
            key: (options?.headers as Record<string, string>)[
              'Idempotence-Key'
            ]!,
            body: options?.body as string,
          });
          return new Response('sensitive provider body', { status });
        },
      },
    );
    const s = new PaymentService(repo, ambiguous, settings);
    const order = await s.create(f.buyer.id, f.reservationId, f.autographId);
    expect((await repo.find(order.id))?.reason).toBe(
      'PROVIDER_OUTCOME_UNKNOWN',
    );
    await database.pool.query(
      "UPDATE payments SET next_check_at=clock_timestamp()-interval '1 minute' WHERE order_id=$1",
      [order.id],
    );
    expect(await repo.due(50)).toContain(order.id);
    await s.reconcile();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(await counts(order.id)).toMatchObject({ takeovers: 0, earnings: 0 });
  },
);
it('a rejected GET for an already-bound payment remains reconcilable', async () => {
  const f = await started();
  const rejected = new PaymentService(
    repo,
    {
      ...provider,
      async getPayment() {
        throw new PaymentError('PROVIDER_REJECTED');
      },
    },
    settings,
  );
  await rejected.progress(f.orderId);
  await database.pool.query(
    "UPDATE payments SET next_check_at=clock_timestamp()-interval '1 minute' WHERE order_id=$1",
    [f.orderId],
  );
  expect(await repo.due(50)).toContain(f.orderId);
  await service().reconcile();
  expect((await repo.find(f.orderId))?.state).toBe('provider_pending');
});
it('create/refresh frequency exhaustion cannot consume bounded webhook capacity', async () => {
  const f = await started();
  let reads = 0;
  const app = api(
    new PaymentService(
      repo,
      {
        ...provider,
        async getPayment(id) {
          reads++;
          return provider.getPayment(id);
        },
      },
      settings,
    ),
  );
  const headers = {
    cookie: `da_session=${f.buyer.token}`,
    origin: 'http://127.0.0.1:3000',
  };
  const callback = () =>
    app.inject({
      method: 'POST',
      url: '/payments/webhooks/yookassa',
      payload: {
        type: 'notification',
        event: 'payment.succeeded',
        object: { id: f.providerId },
      },
    });
  try {
    for (let i = 0; i < 60; i++) {
      const response = await app.inject(
        i % 2
          ? {
              method: 'POST',
              url: `/payments/orders/${f.orderId}/refresh`,
              headers,
              payload: {},
            }
          : {
              method: 'POST',
              url: '/payments/orders',
              headers,
              payload: {
                reservationId: f.reservationId,
                autographId: f.autographId,
              },
            },
      );
      expect(response.statusCode).toBe(200);
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/payments/orders/${f.orderId}/refresh`,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(429);
    const before = reads;
    for (let i = 0; i < 60; i++)
      expect((await callback()).statusCode).toBe(200);
    expect(reads - before).toBe(120); // two verified reads per callback, still bounded
    expect((await callback()).statusCode).toBe(429);
    expect(reads - before).toBe(120);
  } finally {
    await app.close();
  }
});
it('four in-flight user operations cannot occupy webhook concurrency capacity', async () => {
  const fixtures: Array<Awaited<ReturnType<typeof started>>> = [];
  for (let i = 0; i < 5; i++) fixtures.push(await started());
  let release!: () => void,
    entered!: () => void,
    reads = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const app = api(
    new PaymentService(
      repo,
      {
        ...provider,
        async getPayment(id) {
          if (++reads <= 4) {
            if (reads === 4) entered();
            await gate;
          }
          return provider.getPayment(id);
        },
      },
      settings,
    ),
  );
  await app.ready();
  const refresh = (f: (typeof fixtures)[number]) =>
    app.inject({
      method: 'POST',
      url: `/payments/orders/${f.orderId}/refresh`,
      headers: {
        cookie: `da_session=${f.buyer.token}`,
        origin: 'http://127.0.0.1:3000',
      },
      payload: {},
    });
  const pending = fixtures.slice(0, 4).map((f) => refresh(f).then((r) => r));
  try {
    await ready;
    const f = fixtures[4]!;
    expect((await refresh(f)).statusCode).toBe(429);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/payments/webhooks/yookassa',
          payload: {
            type: 'notification',
            event: 'payment.succeeded',
            object: { id: f.providerId },
          },
        })
      ).statusCode,
    ).toBe(200);
    expect(reads).toBe(6);
  } finally {
    release();
    await Promise.all(pending);
    await app.close();
  }
});

it('uses one post-User-lock fulfillment instant and preserves paid visibility after a real wait', async () => {
  const f = await setup(undefined, 2);
  const competitor = await person();
  const o = await service().create(f.buyer.id, f.reservationId, f.autographId);
  const payment = (await repo.find(o.id))!;
  succeed(payment.providerPaymentId!);
  const blocker = await database.pool.connect();
  let processing: Promise<void> | undefined;
  try {
    await blocker.query('BEGIN');
    const pid = (
      await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
    ).rows[0]!.pid;
    await blocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [
      f.buyer.id,
    ]);
    processing = service().webhook(
      payment.providerPaymentId!,
      'payment.succeeded',
    );
    // Observe the real wait on this connection, not an assumption based on a sleep.
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      const wait = await database.pool.query<{ waiting: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
          AND wait_event_type='Lock' AND $1::integer=ANY(pg_blocking_pids(pid))
          AND query LIKE '%FROM users%FOR SHARE%') AS waiting`,
        [pid],
      );
      if (wait.rows[0]!.waiting) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(waiting).toBe(true);
    // PostgreSQL holds the lock longer than the complete two-second visibility window.
    await blocker.query('SELECT pg_sleep(3)');
    const releasedAt = (
      await blocker.query<{ now: Date }>('SELECT clock_timestamp() AS now')
    ).rows[0]!.now;
    await blocker.query('COMMIT');
    await processing;
    expect(await counts(o.id)).toMatchObject({
      status: 'fulfilled',
      takeovers: 1,
      earnings: 1,
      active: 1,
    });
    const instants = await database.pool.query<{
      started_at: Date;
      coherent: boolean;
      checked_at: Date;
    }>(
      `SELECT placed.started_at, clock_timestamp() AS checked_at,
         previous.ended_at=placed.started_at AND r.consumed_at=placed.started_at
         AND o.fulfilled_at=placed.started_at AS coherent
       FROM payment_orders o JOIN placements placed ON placed.id=o.placement_id
       JOIN placements previous ON previous.id=o.target_placement_id
       JOIN takeover_reservations r ON r.id=o.reservation_id WHERE o.id=$1`,
      [o.id],
    );
    const result = instants.rows[0]!;
    // All four fields preserve the same exact SQL instant; bounds use PG time only.
    expect(result.coherent).toBe(true);
    expect(result.started_at.getTime()).toBeGreaterThanOrEqual(
      releasedAt.getTime(),
    );
    expect(result.started_at.getTime()).toBeLessThanOrEqual(
      result.checked_at.getTime(),
    );
    await expect(
      new TakeoverQuoteService(
        createPgPricingRepository(database.pool),
      ).createQuote({
        userId: competitor.id,
        wallId: f.wallId,
        slotId: f.slots[0]!.slotId,
      }),
    ).rejects.toMatchObject({ code: 'TAKEOVER_COOLDOWN_ACTIVE' });
    // Duplicate authenticated observations must not restart/backdate this instant.
    await service().refresh(f.buyer.id, o.id);
    await service().reconcile();
    await service().webhook(payment.providerPaymentId!, 'payment.succeeded');
    expect(
      (
        await database.pool.query<{ fulfilled_at: Date }>(
          'SELECT fulfilled_at FROM payment_orders WHERE id=$1',
          [o.id],
        )
      ).rows[0]!.fulfilled_at,
    ).toEqual(result.started_at);
    expect(await counts(o.id)).toMatchObject({
      takeovers: 1,
      earnings: 1,
      active: 1,
    });
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await processing;
  }
});
