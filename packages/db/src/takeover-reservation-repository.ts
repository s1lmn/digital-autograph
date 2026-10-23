import {
  isWallTakeoverEligible,
  type WallStatus,
} from '@digital-autograph/domain';
import {
  ReservationError,
  type ReservationCreation,
  type TakeoverReservation,
  type TakeoverReservationRepository,
} from '@digital-autograph/walls';
import type { Pool, PoolClient } from 'pg';

type QuoteRow = {
  id: string;
  user_id: string;
  wall_id: string;
  slot_id: string;
  target_placement_id: string;
  pricing_config_id: string;
  algorithm_version: string;
  currency: string;
  amount_minor: string;
  expires_at: Date;
};
type ReservationRow = {
  id: string;
  quote_id: string;
  wall_id: string;
  slot_id: string;
  target_placement_id: string;
  pricing_config_id: string;
  amount_minor: string;
  currency: string;
  status: 'active' | 'expired' | 'cancelled' | 'consumed';
  created_at: Date;
  expires_at: Date;
};
type PgError = Error & { code?: string; constraint?: string };

const reservationColumns = `id, quote_id, wall_id, slot_id,
  target_placement_id, pricing_config_id, amount_minor, currency,
  status, created_at, expires_at`;

function present(row: ReservationRow): TakeoverReservation {
  return {
    id: row.id,
    quoteId: row.quote_id,
    wallId: row.wall_id,
    slotId: row.slot_id,
    targetPlacementId: row.target_placement_id,
    pricingConfigId: row.pricing_config_id,
    amountMinor: row.amount_minor,
    currency: row.currency as 'RUB',
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

async function transaction<T>(pool: Pool, run: (db: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function expireSlot(db: PoolClient, slotId: string, now: Date) {
  await db.query(
    `UPDATE takeover_reservations
     SET status = 'expired', expired_at = $2::timestamptz
     WHERE slot_id = $1::uuid AND status = 'active'
       AND expires_at <= $2::timestamptz`,
    [slotId, now],
  );
}

async function existingByKey(
  db: Pool | PoolClient,
  userId: string,
  hash: string,
) {
  const found = await db.query<ReservationRow & { quote_id: string }>(
    `SELECT ${reservationColumns} FROM takeover_reservations
     WHERE user_id = $1::uuid AND idempotency_key_hash = $2`,
    [userId, hash],
  );
  return found.rows[0] ?? null;
}

async function existingByQuote(db: Pool | PoolClient, quoteId: string) {
  const found = await db.query<{ id: string }>(
    'SELECT id FROM takeover_reservations WHERE quote_id = $1::uuid',
    [quoteId],
  );
  return found.rows[0] ?? null;
}

async function createInTransaction(
  db: PoolClient,
  input: Parameters<TakeoverReservationRepository['create']>[0],
  afterSlotLock?: () => Promise<void>,
): Promise<ReservationCreation> {
  // Global per-user admission lock, acquired before Wall -> Slot. No other
  // writer takes this lock, and admission never locks other users' Slots.
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('reservation-admission:' || $1::uuid::text, 0))",
    [input.userId],
  );
  const replay = await existingByKey(
    db,
    input.userId,
    input.idempotencyKeyHash,
  );
  if (replay) {
    if (replay.quote_id !== input.quoteId) {
      throw new ReservationError('IDEMPOTENCY_KEY_REUSED');
    }
    return {
      reservation: await ownedInTransaction(db, input.userId, replay.id, false),
      created: false,
    };
  }
  const quoteResult = await db.query<QuoteRow>(
    `SELECT id, user_id, wall_id, slot_id, target_placement_id,
            pricing_config_id, algorithm_version, currency, amount_minor,
            expires_at
     FROM takeover_quotes WHERE id = $1::uuid AND user_id = $2::uuid`,
    [input.quoteId, input.userId],
  );
  const quote = quoteResult.rows[0];
  if (!quote) throw new ReservationError('QUOTE_NOT_FOUND');

  // All Placement writers for this Slot must use Wall -> Slot. The Wall SHARE
  // lock serializes with lifecycle UPDATE; Slot UPDATE serializes buyers and
  // the existing Free Claim writer. Sample PostgreSQL time after lock waits.
  const wallResult = await db.query<{
    status: WallStatus;
    start_at: Date | null;
    end_at: Date | null;
    pricing_config_id: string | null;
  }>(
    `SELECT status, start_at, end_at, pricing_config_id FROM walls
     WHERE id = $1::uuid FOR SHARE`,
    [quote.wall_id],
  );
  const wall = wallResult.rows[0];
  if (!wall || wall.pricing_config_id !== quote.pricing_config_id) {
    throw new ReservationError('INVALID_QUOTE_STATE');
  }
  const slotResult = await db.query<{ wall_id: string }>(
    'SELECT wall_id FROM slots WHERE id = $1::uuid FOR UPDATE',
    [quote.slot_id],
  );
  if (slotResult.rows[0]?.wall_id !== quote.wall_id) {
    throw new ReservationError('INVALID_QUOTE_STATE');
  }
  await afterSlotLock?.();
  const targetResult = await db.query<{
    slot_id: string;
    user_id: string;
    started_at: Date;
    ended_at: Date | null;
  }>(
    `SELECT slot_id, user_id, started_at, ended_at FROM placements
     WHERE id = $1::uuid FOR SHARE`,
    [quote.target_placement_id],
  );
  const target = targetResult.rows[0];
  if (!target || target.slot_id !== quote.slot_id) {
    throw new ReservationError('INVALID_QUOTE_STATE');
  }
  const configResult = await db.query<{
    algorithm_version: string;
    currency: string;
    guaranteed_visibility_seconds: number;
  }>(
    `SELECT algorithm_version, currency, guaranteed_visibility_seconds
     FROM pricing_config_versions WHERE id = $1::uuid`,
    [quote.pricing_config_id],
  );
  const config = configResult.rows[0];
  if (
    !config ||
    config.algorithm_version !== quote.algorithm_version ||
    config.currency !== quote.currency ||
    quote.currency !== 'RUB' ||
    BigInt(quote.amount_minor) < 1n ||
    BigInt(quote.amount_minor) > 100000000000n ||
    target.user_id === input.userId
  ) {
    throw new ReservationError('INVALID_QUOTE_STATE');
  }

  const timeResult = await db.query<{ now: Date; quote_valid: boolean }>(
    `WITH snapshot AS MATERIALIZED (SELECT clock_timestamp() AS now)
     SELECT snapshot.now, q.expires_at > snapshot.now AS quote_valid
     FROM snapshot JOIN takeover_quotes q ON q.id = $1::uuid`,
    [quote.id],
  );
  const time = timeResult.rows[0];
  if (!time) throw new Error('PostgreSQL reservation clock unavailable');
  await expireSlot(db, quote.slot_id, time.now);

  // Exact retries return the same historical row even when the Quote or
  // Reservation has since expired or the Wall/target changed.
  const byKey = await existingByKey(db, input.userId, input.idempotencyKeyHash);
  if (byKey) {
    if (byKey.quote_id !== quote.id) {
      throw new ReservationError('IDEMPOTENCY_KEY_REUSED');
    }
    return { reservation: present(byKey), created: false };
  }
  if (await existingByQuote(db, quote.id)) {
    throw new ReservationError('QUOTE_ALREADY_RESERVED');
  }
  if (!time.quote_valid) throw new ReservationError('QUOTE_EXPIRED');
  if (
    !isWallTakeoverEligible(
      { status: wall.status, startAt: wall.start_at, endAt: wall.end_at },
      time.now,
    )
  ) {
    throw new ReservationError('WALL_NOT_TAKEOVER_ELIGIBLE');
  }
  if (target.ended_at !== null) {
    throw new ReservationError('QUOTE_TARGET_STALE');
  }
  const availableAt = new Date(
    target.started_at.getTime() + config.guaranteed_visibility_seconds * 1000,
  );
  if (time.now < availableAt) {
    throw new ReservationError('TAKEOVER_COOLDOWN_ACTIVE');
  }
  const active = await db.query(
    `SELECT 1 FROM takeover_reservations
     WHERE slot_id = $1::uuid AND status = 'active'`,
    [quote.slot_id],
  );
  if (active.rowCount) throw new ReservationError('SLOT_RESERVED');

  // Read effective state without locking other Slots. Expired rows need not
  // be updated to stop counting. All historical states count toward velocity.
  const admission = await db.query<{
    active_until: Date | null;
    recent_count: string;
    oldest_recent: Date | null;
  }>(
    `SELECT min(expires_at) FILTER (
              WHERE status = 'active' AND expires_at > $2::timestamptz
            ) AS active_until,
            count(*) FILTER (
              WHERE created_at > $2::timestamptz - interval '60 seconds'
            ) AS recent_count,
            min(created_at) FILTER (
              WHERE created_at > $2::timestamptz - interval '60 seconds'
            ) AS oldest_recent
     FROM takeover_reservations
     WHERE user_id = $1::uuid
       AND (created_at > $2::timestamptz - interval '60 seconds'
            OR (status = 'active' AND expires_at > $2::timestamptz))`,
    [input.userId, time.now],
  );
  const state = admission.rows[0]!;
  const retryAfter = (until: Date) =>
    Math.max(1, Math.ceil((until.getTime() - time.now.getTime()) / 1000));
  if (state.active_until) {
    throw new ReservationError(
      'USER_RESERVATION_ACTIVE',
      retryAfter(state.active_until),
    );
  }
  if (Number(state.recent_count) >= 5 && state.oldest_recent) {
    throw new ReservationError(
      'RESERVATION_RATE_LIMITED',
      retryAfter(new Date(state.oldest_recent.getTime() + 60_000)),
    );
  }

  // Copy all financial/target fields from the immutable Quote inside SQL.
  const inserted = await db.query<ReservationRow>(
    `INSERT INTO takeover_reservations
       (quote_id, user_id, wall_id, slot_id, target_placement_id,
        pricing_config_id, currency, amount_minor, idempotency_key_hash,
        status, created_at, expires_at)
     SELECT q.id, q.user_id, q.wall_id, q.slot_id, q.target_placement_id,
            q.pricing_config_id, q.currency, q.amount_minor, $2, 'active',
            $3::timestamptz,
            $3::timestamptz + $4::integer * interval '1 second'
     FROM takeover_quotes q WHERE q.id = $1::uuid
     RETURNING ${reservationColumns}`,
    [quote.id, input.idempotencyKeyHash, time.now, input.ttlSeconds],
  );
  const created = inserted.rows[0];
  if (!created) throw new Error('Reservation insertion returned no row');
  return { reservation: present(created), created: true };
}

async function ownedInTransaction(
  db: PoolClient,
  userId: string,
  reservationId: string,
  cancel: boolean,
): Promise<TakeoverReservation> {
  const pointer = await db.query<{ slot_id: string }>(
    `SELECT slot_id FROM takeover_reservations
     WHERE id = $1::uuid AND user_id = $2::uuid`,
    [reservationId, userId],
  );
  if (!pointer.rows[0]) throw new ReservationError('RESERVATION_NOT_FOUND');
  await db.query('SELECT id FROM slots WHERE id = $1::uuid FOR UPDATE', [
    pointer.rows[0].slot_id,
  ]);
  const time = await db.query<{ now: Date }>('SELECT clock_timestamp() AS now');
  const now = time.rows[0]?.now;
  if (!now) throw new Error('PostgreSQL reservation clock unavailable');
  await expireSlot(db, pointer.rows[0].slot_id, now);
  if (cancel) {
    await db.query(
      `UPDATE takeover_reservations
       SET status = 'cancelled', cancelled_at = $3::timestamptz
       WHERE id = $1::uuid AND user_id = $2::uuid AND status = 'active'`,
      [reservationId, userId, now],
    );
  }
  const result = await db.query<ReservationRow>(
    `SELECT ${reservationColumns} FROM takeover_reservations
     WHERE id = $1::uuid AND user_id = $2::uuid`,
    [reservationId, userId],
  );
  const row = result.rows[0];
  if (!row) throw new ReservationError('RESERVATION_NOT_FOUND');
  return present(row);
}

export function createPgTakeoverReservationRepository(
  pool: Pool,
  options: { afterSlotLock?: () => Promise<void> } = {},
): TakeoverReservationRepository {
  return {
    async create(input) {
      try {
        return await transaction(pool, (db) =>
          createInTransaction(db, input, options.afterSlotLock),
        );
      } catch (error) {
        const pg = error as PgError;
        if (pg.code === '23505') {
          if (pg.constraint === 'takeover_reservations_user_key_uidx') {
            const prior = await existingByKey(
              pool,
              input.userId,
              input.idempotencyKeyHash,
            );
            if (prior?.quote_id === input.quoteId) {
              return { reservation: present(prior), created: false };
            }
            throw new ReservationError('IDEMPOTENCY_KEY_REUSED');
          }
          if (pg.constraint === 'takeover_reservations_quote_uidx') {
            throw new ReservationError('QUOTE_ALREADY_RESERVED');
          }
          if (pg.constraint === 'takeover_reservations_one_active_slot_uidx') {
            throw new ReservationError('SLOT_RESERVED');
          }
        }
        throw error;
      }
    },
    findOwned(userId, reservationId) {
      return transaction(pool, (db) =>
        ownedInTransaction(db, userId, reservationId, false),
      );
    },
    cancelOwned(userId, reservationId) {
      return transaction(pool, (db) =>
        ownedInTransaction(db, userId, reservationId, true),
      );
    },
  };
}
