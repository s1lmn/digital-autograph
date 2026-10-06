import { randomUUID } from 'node:crypto';
import {
  notificationKinds,
  type NotificationKind,
} from '@digital-autograph/domain';
import {
  NotificationError,
  type NotificationRepository,
  type Preferences,
  type Delivery,
} from '@digital-autograph/notifications';
import type { Pool, PoolClient } from 'pg';

type PrefRow = {
  user_id: string;
  web: boolean;
  telegram: boolean;
  muted_kinds: NotificationKind[];
  chat_id: string | null;
};
type EventRow = {
  id: string;
  user_id: string;
  kind: NotificationKind;
  wall_id: string;
  slot_id: string | null;
  detail: string | null;
  source_key: string;
};
const view = (p: PrefRow): Preferences => ({
  web: p.web,
  telegram: p.telegram,
  mutedKinds: p.muted_kinds,
  telegramLinked: p.chat_id !== null,
});
async function transaction<T>(
  pool: Pool,
  op: (db: PoolClient) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const value = await op(db);
    await db.query('COMMIT');
    return value;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
async function preference(db: PoolClient, userId: string): Promise<PrefRow> {
  await db.query(
    'INSERT INTO notification_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING',
    [userId],
  );
  const p = await db.query<PrefRow>(
    'SELECT * FROM notification_preferences WHERE user_id=$1 FOR UPDATE',
    [userId],
  );
  if (!p.rows[0]) throw new NotificationError('NOT_FOUND');
  return p.rows[0];
}
async function stillRelevant(
  db: PoolClient,
  event: EventRow,
): Promise<boolean> {
  if (event.kind === 'drop_starting' || event.kind === 'drop_ending') {
    return !!(
      await db.query(
        `SELECT 1 FROM notification_subscriptions sub JOIN walls w ON w.id=sub.wall_id
      CROSS JOIN LATERAL (VALUES ('drop_starting',w.start_at),('drop_ending',w.end_at)) v(kind,at)
      WHERE sub.user_id=$1 AND w.id=$2 AND v.kind=$3
      AND $4='drop:'||w.id||':'||sub.user_id||':'||v.kind||':'||v.at::text
      AND ((v.kind='drop_starting' AND w.status='scheduled') OR (v.kind='drop_ending' AND w.status IN ('live','paused')))
      AND v.at BETWEEN clock_timestamp() AND clock_timestamp()+interval '15 minutes'`,
        [event.user_id, event.wall_id, event.kind, event.source_key],
      )
    ).rowCount;
  }
  if (event.kind === 'cooldown_ended') {
    return !!(
      await db.query(
        `SELECT 1 FROM placements p JOIN slots s ON s.id=p.slot_id JOIN walls w ON w.id=s.wall_id
      JOIN pricing_config_versions pc ON pc.id=w.pricing_config_id
      WHERE 'cooldown:'||p.id=$1 AND p.ended_at IS NULL AND w.status='live'
      AND p.started_at+pc.guaranteed_visibility_seconds*interval '1 second' BETWEEN clock_timestamp()-interval '15 minutes' AND clock_timestamp()
      AND (w.end_at IS NULL OR w.end_at>clock_timestamp())`,
        [event.source_key],
      )
    ).rowCount;
  }
  return true;
}
export function createPgNotificationRepository(
  pool: Pool,
): NotificationRepository {
  return {
    preferences: (userId) =>
      transaction(pool, async (db) => view(await preference(db, userId))),
    updatePreferences: (userId, input) =>
      transaction(pool, async (db) => {
        const p = await preference(db, userId);
        if (input.telegram && !p.chat_id)
          throw new NotificationError('CHANNEL_NOT_LINKED');
        if (input.mutedKinds.some((k) => !notificationKinds.includes(k)))
          throw new NotificationError('INVALID_REQUEST');
        const changed = await db.query<PrefRow>(
          `UPDATE notification_preferences SET web=$2, telegram=$3, muted_kinds=$4::jsonb,
        consent_at=CASE WHEN $3 THEN COALESCE(consent_at,clock_timestamp()) ELSE NULL END
        WHERE user_id=$1 RETURNING *`,
          [userId, input.web, input.telegram, JSON.stringify(input.mutedKinds)],
        );
        // Suppress pending external deliveries under the same preference lock used by claim.
        await db.query(
          `UPDATE notification_deliveries d SET state='suppressed'
        FROM notification_events e WHERE d.event_id=e.id AND e.user_id=$1 AND d.channel='telegram'
        AND d.state IN ('queued','retry') AND (NOT $2 OR e.kind = ANY($3::text[]))`,
          [userId, input.telegram, input.mutedKinds],
        );
        return view(changed.rows[0]!);
      }),
    async inbox(userId) {
      const result = await pool.query<
        EventRow & { created_at: Date; read_at: Date | null }
      >(
        `SELECT d.id,e.kind,e.wall_id,e.slot_id,e.detail,e.source_key,d.created_at,d.read_at
        FROM notification_deliveries d JOIN notification_events e ON e.id=d.event_id
        WHERE e.user_id=$1 AND d.channel='web' AND d.state='sent' ORDER BY d.created_at DESC,d.id DESC LIMIT 100`,
        [userId],
      );
      return result.rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        wallId: r.wall_id,
        slotId: r.slot_id,
        detail: r.detail,
        createdAt: r.created_at,
        readAt: r.read_at,
        contextId:
          r.kind === 'payment_status' ? r.source_key.split(':')[1] : undefined,
      }));
    },
    async read(userId, id) {
      const r = await pool.query(
        `UPDATE notification_deliveries d SET read_at=COALESCE(read_at,clock_timestamp())
        FROM notification_events e WHERE e.id=d.event_id AND e.user_id=$1 AND d.id=$2 AND d.channel='web' AND d.state='sent'`,
        [userId, id],
      );
      if (!r.rowCount) throw new NotificationError('NOT_FOUND');
    },
    follow: (userId, wallId, enabled) =>
      transaction(pool, async (db) => {
        await preference(db, userId);
        if (!enabled) {
          await db.query(
            'DELETE FROM notification_subscriptions WHERE user_id=$1 AND wall_id=$2',
            [userId, wallId],
          );
          return;
        }
        const wall = await db.query(
          "SELECT 1 FROM walls WHERE id=$1 AND status IN ('scheduled','live','paused','ended') FOR SHARE",
          [wallId],
        );
        if (!wall.rowCount) throw new NotificationError('NOT_FOUND');
        const count = await db.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM notification_subscriptions WHERE user_id=$1',
          [userId],
        );
        const existing = await db.query(
          'SELECT 1 FROM notification_subscriptions WHERE user_id=$1 AND wall_id=$2',
          [userId, wallId],
        );
        if (!existing.rowCount && count.rows[0]!.n >= 100)
          throw new NotificationError('RATE_LIMITED');
        await db.query(
          'INSERT INTO notification_subscriptions (user_id,wall_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [userId, wallId],
        );
      }),
    issueLink: (userId, hash) =>
      transaction(pool, async (db) => {
        await preference(db, userId);
        const r = await db.query(
          `UPDATE notification_preferences SET link_hash=$2,link_expires_at=clock_timestamp()+interval '10 minutes'
        WHERE user_id=$1 AND (link_expires_at IS NULL OR link_expires_at < clock_timestamp()+interval '9 minutes')`,
          [userId, hash],
        );
        if (!r.rowCount) throw new NotificationError('RATE_LIMITED');
      }),
    acceptLink: (hash, chatId) =>
      transaction(pool, async (db) => {
        const r = await db.query(
          `UPDATE notification_preferences p SET chat_id=$2,telegram=true,consent_at=clock_timestamp(),linked_at=clock_timestamp(),link_hash=NULL,link_expires_at=NULL
        WHERE link_hash=$1 AND link_expires_at>clock_timestamp() AND EXISTS (SELECT 1 FROM users u WHERE u.id=p.user_id AND u.status='active') RETURNING user_id`,
          [hash, chatId],
        );
        if (!r.rowCount) throw new NotificationError('NOT_FOUND');
      }),
    disconnect: (userId) =>
      transaction(pool, async (db) => {
        await preference(db, userId);
        await db.query(
          'UPDATE notification_preferences SET telegram=false,chat_id=NULL,consent_at=NULL,link_hash=NULL,link_expires_at=NULL,linked_at=NULL WHERE user_id=$1',
          [userId],
        );
        await db.query(
          `UPDATE notification_deliveries d SET state='suppressed' FROM notification_events e
        WHERE e.id=d.event_id AND e.user_id=$1 AND d.channel='telegram' AND d.state IN ('queued','retry')`,
          [userId],
        );
      }),
    async stopChat(chatId) {
      // /stop revokes pending challenges too; they cannot reconnect on replay.
      await pool.query(
        'UPDATE notification_preferences SET telegram=false,consent_at=NULL,link_hash=NULL,link_expires_at=NULL WHERE chat_id=$1',
        [chatId],
      );
    },
    async collect() {
      // Timed reminders derive from persisted current state, never change eligibility.
      // Short window avoids a backlog of obsolete reminders after downtime.
      await pool.query(`INSERT INTO notification_events (source_key,user_id,kind,wall_id,slot_id)
        SELECT 'cooldown:'||p.id,p.user_id,'cooldown_ended',w.id,s.id
        FROM placements p JOIN slots s ON s.id=p.slot_id JOIN walls w ON w.id=s.wall_id
        JOIN pricing_config_versions pc ON pc.id=w.pricing_config_id
        WHERE p.ended_at IS NULL AND w.status='live' AND pc.guaranteed_visibility_seconds>0
        AND p.started_at + pc.guaranteed_visibility_seconds*interval '1 second' BETWEEN clock_timestamp()-interval '15 minutes' AND clock_timestamp()
        AND (w.end_at IS NULL OR w.end_at>clock_timestamp()) ON CONFLICT DO NOTHING`);
      await pool.query(`INSERT INTO notification_events (source_key,user_id,kind,wall_id)
        SELECT 'drop:'||w.id||':'||sub.user_id||':'||v.kind||':'||v.at::text,sub.user_id,v.kind,w.id
        FROM notification_subscriptions sub JOIN walls w ON w.id=sub.wall_id
        CROSS JOIN LATERAL (VALUES ('drop_starting',w.start_at),('drop_ending',w.end_at)) v(kind,at)
        WHERE ((v.kind='drop_starting' AND w.status='scheduled') OR (v.kind='drop_ending' AND w.status IN ('live','paused')))
        AND v.at BETWEEN clock_timestamp() AND clock_timestamp()+interval '15 minutes' ON CONFLICT DO NOTHING`);
      for (let i = 0; i < 20; i++) {
        const found = await transaction(pool, async (db) => {
          const event = (
            await db.query<EventRow>(
              `SELECT * FROM notification_events WHERE processed_at IS NULL ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,
            )
          ).rows[0];
          if (!event) return false;
          const p = await preference(db, event.user_id);
          const active = (
            await db.query(
              "SELECT 1 FROM users WHERE id=$1 AND status='active'",
              [event.user_id],
            )
          ).rowCount;
          const relevant = await stillRelevant(db, event);
          for (const channel of ['web', 'telegram'] as const) {
            let permitted =
              !!active &&
              relevant &&
              p[channel] &&
              !p.muted_kinds.includes(event.kind);
            const budget = await db.query<{ n: number; recent: boolean }>(
              `SELECT count(*)::int n,
              COALESCE(bool_or(e.kind=$3 AND e.wall_id=$4 AND d.created_at>clock_timestamp()-interval '10 minutes'),false) recent
              FROM notification_deliveries d JOIN notification_events e ON e.id=d.event_id
              WHERE e.user_id=$1 AND d.channel=$2 AND d.state<>'suppressed' AND d.created_at>clock_timestamp()-interval '1 hour'`,
              [event.user_id, channel, event.kind, event.wall_id],
            );
            // Each financial fact has its own source identity. Do not collapse
            // different Orders/statuses into the ordinary per-Wall spam budget.
            const financial =
              event.kind === 'payment_status' || event.kind === 'refund_status';
            permitted =
              permitted &&
              budget.rows[0]!.n < 20 &&
              (financial || !budget.rows[0]!.recent);
            // Old captured events are visible in-app but are not sent to a newly linked channel.
            if (channel === 'telegram') {
              permitted =
                permitted &&
                !!(
                  await db.query(
                    `SELECT 1 FROM notification_preferences p JOIN notification_events e ON e.id=$2
                WHERE p.user_id=$1 AND p.telegram AND p.chat_id IS NOT NULL AND p.consent_at IS NOT NULL AND e.created_at>=p.linked_at`,
                    [event.user_id, event.id],
                  )
                ).rowCount;
            }
            await db.query(
              `INSERT INTO notification_deliveries (event_id,channel,state,created_at) VALUES ($1,$2,$3,clock_timestamp()) ON CONFLICT DO NOTHING`,
              [
                event.id,
                channel,
                permitted
                  ? channel === 'web'
                    ? 'sent'
                    : 'queued'
                  : 'suppressed',
              ],
            );
          }
          await db.query(
            'UPDATE notification_events SET processed_at=clock_timestamp() WHERE id=$1',
            [event.id],
          );
          return true;
        });
        if (!found) break;
      }
    },
    claimDelivery: () =>
      transaction(pool, async (db) => {
        // A crash after the send started is ambiguous. Never reclaim and resend it.
        await db.query(
          "UPDATE notification_deliveries SET state='uncertain' WHERE state='sending' AND lease_until<clock_timestamp()",
        );
        if (
          !(
            await db.query<{ ok: boolean }>(
              'SELECT pg_try_advisory_xact_lock(940094) ok',
            )
          ).rows[0]!.ok
        )
          return null;
        if (
          (
            await db.query(
              "SELECT 1 FROM notification_deliveries WHERE attempt_at>clock_timestamp()-interval '1 second' LIMIT 1",
            )
          ).rowCount
        )
          return null;
        const candidate = (
          await db.query<{
            user_id: string;
          }>(`SELECT e.user_id FROM notification_deliveries d JOIN notification_events e ON e.id=d.event_id
        WHERE d.channel='telegram' AND d.state IN ('queued','retry') AND d.available_at<=clock_timestamp() ORDER BY d.available_at LIMIT 1`)
        ).rows[0];
        if (!candidate) return null;
        const p = await preference(db, candidate.user_id);
        const job = (
          await db.query<EventRow & { delivery_id: string }>(
            `SELECT e.*,d.id delivery_id FROM notification_deliveries d JOIN notification_events e ON e.id=d.event_id
        WHERE e.user_id=$1 AND d.channel='telegram' AND d.state IN ('queued','retry') AND d.available_at<=clock_timestamp() ORDER BY d.available_at LIMIT 1 FOR UPDATE OF d SKIP LOCKED`,
            [candidate.user_id],
          )
        ).rows[0];
        if (!job) return null;
        const allowed =
          (await stillRelevant(db, job)) &&
          p.telegram &&
          p.chat_id &&
          !p.muted_kinds.includes(job.kind) &&
          (
            await db.query(
              `SELECT 1 FROM notification_preferences p JOIN users u ON u.id=p.user_id JOIN notification_events e ON e.id=$2
        WHERE p.user_id=$1 AND u.status='active' AND p.consent_at IS NOT NULL AND p.linked_at<=e.created_at`,
              [p.user_id, job.id],
            )
          ).rowCount;
        if (!allowed) {
          await db.query(
            "UPDATE notification_deliveries SET state='suppressed' WHERE id=$1",
            [job.delivery_id],
          );
          return null;
        }
        const token = randomUUID();
        await db.query(
          "UPDATE notification_deliveries SET state='sending',attempts=attempts+1,attempt_at=clock_timestamp(),lease_token=$2,lease_until=clock_timestamp()+interval '60 seconds' WHERE id=$1",
          [job.delivery_id, token],
        );
        return {
          id: job.delivery_id,
          token,
          chatId: p.chat_id!,
          kind: job.kind,
          wallId: job.wall_id,
          slotId: job.slot_id,
          detail: job.detail,
          contextId:
            job.kind === 'payment_status'
              ? job.source_key.split(':')[1]
              : undefined,
        } satisfies Delivery;
      }),
    async finishDelivery(delivery, result) {
      await pool.query(
        `UPDATE notification_deliveries SET state=CASE WHEN $3='retry' AND attempts>=5 THEN 'failed' ELSE $3 END,
        available_at=clock_timestamp()+make_interval(secs => $4),lease_token=NULL,lease_until=NULL
        WHERE id=$1 AND lease_token=$2 AND state='sending' AND lease_until>clock_timestamp()`,
        [
          delivery.id,
          delivery.token,
          result.state,
          Math.min(86400, Math.max(1, result.retryAfterSeconds ?? 60)),
        ],
      );
    },
  };
}
