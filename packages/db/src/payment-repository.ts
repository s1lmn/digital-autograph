import { loadLegalDocuments } from '@digital-autograph/config';
import {
  requireLegalDocument,
  type LegalDocument,
} from '@digital-autograph/domain';
import { randomUUID } from 'node:crypto';
import { AutographError } from '@digital-autograph/autographs';
import {
  isWallTakeoverEligible,
  type WallStatus,
} from '@digital-autograph/domain';
import {
  PaymentError,
  bindingFailure,
  normalizePaymentStatus,
  canTransition,
  fingerprint,
  type PaymentAttempt,
  type PaymentObservation,
  type PaymentRepository,
  type PaymentSettings,
  type PaymentState,
} from '@digital-autograph/payments';
import type { Pool, PoolClient } from 'pg';
import { verifyAutographEvidence } from './autograph-evidence';

type OrderRow = {
  id: string;
  user_id: string;
  reservation_id: string;
  quote_id: string;
  wall_id: string;
  slot_id: string;
  target_placement_id: string;
  autograph_id: string;
  creator_id: string;
  pricing_config_id: string;
  amount_minor: string;
  currency: 'RUB';
  creator_share_bps: number;
  status: PaymentState;
  placement_id: string | null;
};
type AttemptRow = OrderRow & {
  payment_id: string;
  shop_id: string;
  mode: 'sandbox' | 'live';
  operation_key: string;
  request_fingerprint: string;
  provider_payment_id: string | null;
  return_url: string;
  confirmation_url: string | null;
  reason: string | null;
  created_at: Date;
  create_retry_allowed: boolean;
};
const columns = `o.*, p.id AS payment_id, p.shop_id, p.mode, p.operation_key, p.request_fingerprint, p.provider_payment_id, p.return_url, p.confirmation_url, p.reason, p.created_at, p.created_at + interval '23 hours' > clock_timestamp() AS create_retry_allowed`;
function present(r: AttemptRow): PaymentAttempt {
  return {
    id: r.payment_id,
    orderId: r.id,
    userId: r.user_id,
    reservationId: r.reservation_id,
    autographId: r.autograph_id,
    shopId: r.shop_id,
    mode: r.mode,
    operationKey: r.operation_key,
    requestFingerprint: r.request_fingerprint,
    providerPaymentId: r.provider_payment_id,
    returnUrl: r.return_url,
    amountMinor: r.amount_minor,
    currency: r.currency,
    state: r.status,
    confirmationUrl: r.confirmation_url,
    reason: r.reason,
    createdAt: r.created_at,
    createRetryAllowed: r.create_retry_allowed,
    placementId: r.placement_id,
  };
}
async function find(db: Pool | PoolClient, id: string) {
  const r = await db.query<AttemptRow>(
    `SELECT ${columns} FROM payment_orders o JOIN payments p ON p.order_id=o.id WHERE o.id=$1::uuid`,
    [id],
  );
  return r.rows[0] ? present(r.rows[0]) : null;
}
async function tx<T>(
  pool: Pool,
  run: (db: PoolClient) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await run(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
async function autographReady(
  db: PoolClient,
  id: string,
  userId: string,
): Promise<boolean> {
  const r = await db.query<{ id: string; user_id: string; status: 'ready' }>(
    'SELECT id,user_id,status FROM autographs WHERE id=$1::uuid FOR SHARE',
    [id],
  );
  const a = r.rows[0];
  if (!a || a.user_id !== userId || a.status !== 'ready') return false;
  try {
    await verifyAutographEvidence(db, a, true);
    return true;
  } catch (error) {
    if (error instanceof AutographError) return false;
    throw error;
  }
}
async function lockTarget(
  db: PoolClient,
  wallId: string,
  slotId: string,
  targetId: string,
) {
  // Shared by every writer: Wall -> Slot -> Placement -> Reservation -> Order -> Payment -> Autograph.
  // Never lock Reservation before Slot: cancellation/lazy expiry already use Slot -> Reservation.
  const w = await db.query<{
    status: WallStatus;
    start_at: Date | null;
    end_at: Date | null;
    creator_id: string;
    pricing_config_id: string;
  }>(
    'SELECT status,start_at,end_at,creator_id,pricing_config_id FROM walls WHERE id=$1::uuid FOR SHARE',
    [wallId],
  );
  const s = await db.query<{ wall_id: string }>(
    'SELECT wall_id FROM slots WHERE id=$1::uuid FOR UPDATE',
    [slotId],
  );
  const p = await db.query<{
    slot_id: string;
    user_id: string;
    ended_at: Date | null;
    started_at: Date;
  }>(
    'SELECT slot_id,user_id,ended_at,started_at FROM placements WHERE id=$1::uuid FOR UPDATE',
    [targetId],
  );
  if (
    !w.rows[0] ||
    s.rows[0]?.wall_id !== wallId ||
    p.rows[0]?.slot_id !== slotId
  )
    throw new PaymentError('INVALID_RESERVATION');
  return { wall: w.rows[0], target: p.rows[0] };
}
async function clock(db: PoolClient) {
  return (await db.query<{ now: Date }>('SELECT clock_timestamp() AS now'))
    .rows[0]!.now;
}
async function eligible(
  db: PoolClient,
  r: OrderRow,
  target: Awaited<ReturnType<typeof lockTarget>>,
): Promise<{ eligible: boolean; evaluatedAt: Date }> {
  const reservation = await db.query<{ status: string; expires_at: Date }>(
    'SELECT status,expires_at FROM takeover_reservations WHERE id=$1::uuid',
    [r.reservation_id],
  );
  const v = reservation.rows[0];
  const config = await db.query<{ guaranteed_visibility_seconds: number }>(
    'SELECT guaranteed_visibility_seconds FROM pricing_config_versions WHERE id=$1::uuid',
    [r.pricing_config_id],
  );
  const user = await db.query<{ status: string }>(
    'SELECT status FROM users WHERE id=$1::uuid FOR SHARE',
    [r.user_id],
  );
  // All eligibility locks, including User, are held before sampling PG time.
  const evaluatedAt = await clock(db);
  return {
    evaluatedAt,
    eligible:
      !!v &&
      v.status === 'active' &&
      v.expires_at > evaluatedAt &&
      target.target.ended_at === null &&
      target.target.user_id !== r.user_id &&
      target.wall.pricing_config_id === r.pricing_config_id &&
      user.rows[0]?.status === 'active' &&
      isWallTakeoverEligible(
        {
          status: target.wall.status,
          startAt: target.wall.start_at,
          endAt: target.wall.end_at,
        },
        evaluatedAt,
      ) &&
      !!config.rows[0] &&
      evaluatedAt.getTime() >=
        target.target.started_at.getTime() +
          config.rows[0].guaranteed_visibility_seconds * 1000,
  };
}
export function createPgPaymentRepository(
  pool: Pool,
  options: {
    afterPlacementInsert?: () => Promise<void>;
    legalDocuments?: readonly LegalDocument[];
  } = {},
): PaymentRepository {
  const legalDocuments = options.legalDocuments ?? loadLegalDocuments();
  async function create(
    userId: string,
    reservationId: string,
    autographId: string,
    settings: PaymentSettings,
  ) {
    return tx(pool, async (db) => {
      const pointer = await db.query<{
        wall_id: string;
        slot_id: string;
        target_placement_id: string;
      }>(
        'SELECT wall_id,slot_id,target_placement_id FROM takeover_reservations WHERE id=$1::uuid AND user_id=$2::uuid',
        [reservationId, userId],
      );
      const ptr = pointer.rows[0];
      if (!ptr) throw new PaymentError('RESERVATION_NOT_FOUND');
      const target = await lockTarget(
        db,
        ptr.wall_id,
        ptr.slot_id,
        ptr.target_placement_id,
      );
      const rr = await db.query<OrderRow>(
        'SELECT *, id AS reservation_id FROM takeover_reservations WHERE id=$1::uuid FOR UPDATE',
        [reservationId],
      );
      const r = rr.rows[0]!;
      const prior = await db.query<{ id: string; autograph_id: string }>(
        'SELECT id,autograph_id FROM payment_orders WHERE reservation_id=$1::uuid',
        [reservationId],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].autograph_id !== autographId)
          throw new PaymentError('ORDER_REQUEST_CONFLICT');
        return (await find(db, prior.rows[0].id))!;
      }
      if (
        !(await autographReady(db, autographId, userId)) ||
        !(await eligible(db, r, target)).eligible
      )
        throw new PaymentError('RESERVATION_NOT_ELIGIBLE');
      const offer = requireLegalDocument(legalDocuments, 'public_offer');
      const rules = requireLegalDocument(
        legalDocuments,
        'community_guidelines',
      );
      const refunds = requireLegalDocument(legalDocuments, 'refund_policy');
      const id = randomUUID();
      await db.query(
        `INSERT INTO payment_orders (id,user_id,reservation_id,quote_id,wall_id,slot_id,target_placement_id,autograph_id,creator_id,pricing_config_id,amount_minor,currency,creator_share_bps,offer_version,offer_hash,content_rules_version,content_rules_hash,refund_policy_version,refund_policy_hash)
    SELECT $2::uuid,r.user_id,r.id,r.quote_id,r.wall_id,r.slot_id,r.target_placement_id,$3::uuid,$4::uuid,r.pricing_config_id,r.amount_minor,r.currency,$5,$6,$7,$8,$9,$10,$11
    FROM takeover_reservations r WHERE r.id=$1::uuid`,
        [
          reservationId,
          id,
          autographId,
          target.wall.creator_id,
          settings.creatorShareBps,
          offer.version,
          offer.hash,
          rules.version,
          rules.hash,
          refunds.version,
          refunds.hash,
        ],
      );
      const returnUrl = new URL(settings.returnUrl);
      returnUrl.searchParams.set('orderId', id);
      const request = {
        orderId: id,
        amountMinor: r.amount_minor,
        currency: r.currency,
        returnUrl: returnUrl.href,
      };
      await db.query(
        `INSERT INTO payments (order_id,provider,shop_id,mode,operation_key,request_fingerprint,return_url,amount_minor,currency)
    VALUES ($1::uuid,'yookassa',$2,$3,$4::uuid,$5,$6,$7::bigint,$8)`,
        [
          id,
          settings.shopId,
          settings.mode,
          randomUUID(),
          fingerprint(request),
          request.returnUrl,
          r.amount_minor,
          r.currency,
        ],
      );
      return (await find(db, id))!;
    });
  }
  async function observe(id: string, token: string, seen: PaymentObservation) {
    await tx(pool, async (db) => {
      const pointer = await db.query<OrderRow>(
        'SELECT * FROM payment_orders WHERE id=$1::uuid',
        [id],
      );
      const ptr = pointer.rows[0];
      if (!ptr) throw new PaymentError('ORDER_NOT_FOUND');
      const target = await lockTarget(
        db,
        ptr.wall_id,
        ptr.slot_id,
        ptr.target_placement_id,
      );
      await db.query(
        'SELECT id FROM takeover_reservations WHERE id=$1::uuid FOR UPDATE',
        [ptr.reservation_id],
      );
      const locked = await db.query<OrderRow>(
        'SELECT * FROM payment_orders WHERE id=$1::uuid FOR UPDATE',
        [id],
      );
      const order = locked.rows[0]!;
      const p = await db.query<{ lease_token: string; valid: boolean }>(
        'SELECT lease_token,lease_until>clock_timestamp() AS valid FROM payments WHERE order_id=$1::uuid FOR UPDATE',
        [id],
      );
      if (p.rows[0]?.lease_token !== token || !p.rows[0].valid)
        throw new PaymentError('PAYMENT_LEASE_LOST');
      const attempt = (await find(db, id))!;
      const failure = bindingFailure(attempt, seen);
      if (failure) throw new PaymentError(failure);
      const normalized = normalizePaymentStatus(seen.rawStatus, seen.paid);
      if (['fulfilled', 'paid_but_not_fulfilled'].includes(attempt.state)) {
        await db.query(
          "UPDATE payments SET next_check_at=clock_timestamp()+interval '1 day' WHERE order_id=$1::uuid",
          [id],
        );
        if (normalized !== 'succeeded')
          await db.query(
            'UPDATE payments SET reason=$2 WHERE order_id=$1::uuid',
            [id, 'TERMINAL_PROVIDER_CONTRADICTION'],
          );
        return;
      }
      let state: PaymentState = normalized;
      let reason: string | null =
        normalized === 'unknown' ? 'UNKNOWN_PROVIDER_STATE' : null;
      if (attempt.state === 'canceled') {
        if (normalized !== 'succeeded') {
          await db.query(
            "UPDATE payments SET next_check_at=clock_timestamp()+interval '1 day' WHERE order_id=$1::uuid",
            [id],
          );
          return;
        }
        state = 'paid_but_not_fulfilled';
        reason = 'SUCCESS_AFTER_CANCELED';
      }
      if (state === 'succeeded') {
        const ready = await autographReady(
          db,
          order.autograph_id,
          order.user_id,
        );
        const eligibility = ready ? await eligible(db, order, target) : null;
        if (!eligibility?.eligible) {
          state = 'paid_but_not_fulfilled';
          reason = 'LATE_OR_INELIGIBLE_PAYMENT';
        } else {
          const now = eligibility.evaluatedAt;
          await db.query(
            "UPDATE placements SET ended_at=$2,end_reason='takeover' WHERE id=$1::uuid",
            [order.target_placement_id, now],
          );
          const placed = await db.query<{ id: string }>(
            `INSERT INTO placements (slot_id,user_id,autograph_id,source,started_at) VALUES ($1::uuid,$2::uuid,$3::uuid,'takeover',$4) RETURNING id`,
            [order.slot_id, order.user_id, order.autograph_id, now],
          );
          await options.afterPlacementInsert?.();
          const placementId = placed.rows[0]!.id;
          await db.query(
            "UPDATE takeover_reservations SET status='consumed',consumed_at=$2 WHERE id=$1::uuid",
            [order.reservation_id, now],
          );
          await db.query(
            "UPDATE payment_orders SET status='fulfilled',placement_id=$2::uuid,fulfilled_at=$3 WHERE id=$1::uuid",
            [id, placementId, now],
          );
          await db.query(
            `INSERT INTO creator_earnings (order_id,payment_id,placement_id,creator_id,gross_amount_minor,amount_minor,share_bps,currency)
      VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::bigint,($5::bigint*$6::bigint)/10000,$6,$7)`,
            [
              id,
              attempt.id,
              placementId,
              order.creator_id,
              order.amount_minor,
              order.creator_share_bps,
              order.currency,
            ],
          );
          state = 'fulfilled';
        }
      }
      if (!canTransition(attempt.state, state))
        throw new PaymentError('INVALID_PAYMENT_TRANSITION');
      await db.query(
        `UPDATE payments SET provider_payment_id=$2,status=$3,raw_status=$4,confirmation_url=$5,verified_at=clock_timestamp(),reason=$6,failures=0,updated_at=clock_timestamp(),next_check_at=clock_timestamp()+interval '1 minute' WHERE order_id=$1::uuid`,
        [id, seen.id, state, seen.rawStatus, seen.confirmationUrl, reason],
      );
      if (state !== 'fulfilled')
        await db.query(
          'UPDATE payment_orders SET status=$2 WHERE id=$1::uuid',
          [id, state],
        );
    });
  }
  return {
    create,
    async findByReservation(userId, reservationId) {
      const ids = await pool.query<{ id: string }>(
        'SELECT id FROM payment_orders WHERE user_id=$1 AND reservation_id=$2',
        [userId, reservationId],
      );
      return ids.rows[0] ? find(pool, ids.rows[0].id) : null;
    },
    find: (id) => find(pool, id),
    observe,
    async lease(id) {
      const token = randomUUID();
      const r = await pool.query(
        `UPDATE payments SET lease_token=$2::uuid,lease_until=clock_timestamp()+interval '60 seconds' WHERE order_id=$1::uuid AND (lease_until IS NULL OR lease_until<clock_timestamp()) RETURNING id`,
        [id, token],
      );
      return r.rowCount ? token : null;
    },
    async release(id, token) {
      await pool.query(
        "UPDATE payments SET lease_token=NULL,lease_until=NULL,next_check_at=GREATEST(next_check_at,clock_timestamp()+interval '1 minute') WHERE order_id=$1::uuid AND lease_token=$2::uuid",
        [id, token],
      );
    },
    async recordFailure(id, token, reason) {
      await tx(pool, async (db) => {
        // Same Order -> Payment sub-order as observe. No Slot locks needed for a signal.
        await db.query(
          'SELECT id FROM payment_orders WHERE id=$1::uuid FOR UPDATE',
          [id],
        );
        const r = await db.query(
          `UPDATE payments SET status=CASE WHEN status IN ('fulfilled','paid_but_not_fulfilled','canceled') THEN status ELSE 'unknown' END,
    reason=$3,failures=failures+1,next_check_at=clock_timestamp()+LEAST(3600,30*power(2,LEAST(failures,6))) * interval '1 second',updated_at=clock_timestamp()
    WHERE order_id=$1::uuid AND lease_token=$2::uuid RETURNING status`,
          [id, token, reason],
        );
        if (r.rows[0])
          await db.query(
            'UPDATE payment_orders SET status=$2 WHERE id=$1::uuid',
            [id, r.rows[0].status],
          );
      });
    },
    async receipt(id, event) {
      await pool.query(
        "INSERT INTO payment_event_receipts (provider,provider_payment_id,event) VALUES ('yookassa',$1,$2) ON CONFLICT DO NOTHING",
        [id, event],
      );
    },
    async completeReceipt(id, event, result) {
      await pool.query(
        "UPDATE payment_event_receipts SET processed_at=clock_timestamp(),result=$3 WHERE provider='yookassa' AND provider_payment_id=$1 AND event=$2",
        [id, event, result],
      );
    },
    async due(limit) {
      const r = await pool.query<{ order_id: string }>(
        `SELECT order_id FROM payments WHERE next_check_at<=clock_timestamp() AND (provider_payment_id IS NOT NULL OR reason IS DISTINCT FROM 'PROVIDER_REJECTED') AND (lease_until IS NULL OR lease_until<clock_timestamp()) ORDER BY next_check_at LIMIT $1`,
        [limit],
      );
      return r.rows.map((x) => x.order_id);
    },
    async anomalies() {
      const r = await pool.query<{ orderId: string; reason: string }>(
        `SELECT o.id AS "orderId",coalesce(p.reason,'FULFILLMENT_EVIDENCE_MISSING') AS reason FROM payment_orders o JOIN payments p ON p.order_id=o.id WHERE p.reason IS NOT NULL OR o.status='paid_but_not_fulfilled' OR (o.status='fulfilled' AND (p.status<>'fulfilled' OR p.verified_at IS NULL OR NOT EXISTS(SELECT 1 FROM creator_earnings e WHERE e.order_id=o.id))) ORDER BY o.created_at LIMIT 100`,
      );
      return r.rows;
    },
  };
}
