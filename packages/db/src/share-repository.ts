import {
  NotificationError,
  type PublicShare,
  type ShareRepository,
} from '@digital-autograph/notifications';
import type { Pool, PoolClient } from 'pg';
async function publicShare(
  db: Pool | PoolClient,
  id: string,
): Promise<PublicShare | null> {
  const r = await db.query<{
    id: string;
    wall_id: string;
    slot_id: string | null;
    position: number | null;
    display_name: string;
    public_alias: string | null;
    event: PublicShare['event'];
  }>(
    `SELECT sh.id,sh.wall_id,sh.slot_id,s.position,cp.display_name,sh.public_alias,sh.event
    FROM share_links sh JOIN walls w ON w.id=sh.wall_id JOIN creator_profiles cp ON cp.creator_id=w.creator_id
    LEFT JOIN slots s ON s.id=sh.slot_id
    WHERE sh.id=$1 AND sh.revoked_at IS NULL AND w.status IN ('scheduled','live','paused','ended')
    AND (sh.placement_id IS NULL OR EXISTS (SELECT 1 FROM placements p JOIN autographs a ON a.id=p.autograph_id
      WHERE p.id=sh.placement_id AND a.user_id=p.user_id AND a.status='ready'))`,
    [id],
  );
  const row = r.rows[0];
  return row
    ? {
        id: row.id,
        wallId: row.wall_id,
        slotId: row.slot_id,
        slotNumber: row.position === null ? null : row.position + 1,
        creator: row.display_name,
        publicAlias: row.public_alias,
        event: row.event,
      }
    : null;
}
export function createPgShareRepository(pool: Pool): ShareRepository {
  return {
    public: (id) => publicShare(pool, id),
    async create(userId, input) {
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        await db.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1,94))',
          [userId],
        );
        const count = await db.query<{ n: number }>(
          "SELECT count(*)::int n FROM share_links WHERE user_id=$1 AND created_at>clock_timestamp()-interval '1 hour'",
          [userId],
        );
        if (count.rows[0]!.n >= 20) throw new NotificationError('RATE_LIMITED');
        const wall = (
          await db.query<{ status: string; owner_user_id: string }>(
            `SELECT w.status,c.owner_user_id FROM walls w JOIN creators c ON c.id=w.creator_id
          WHERE w.id=$1 AND w.status IN ('scheduled','live','paused','ended') FOR SHARE OF w`,
            [input.wallId],
          )
        ).rows[0];
        if (!wall) throw new NotificationError('NOT_FOUND');
        let placementId: string | null = null;
        let event: PublicShare['event'] = 'final_wall';
        if (input.slotId) {
          const p = (
            await db.query<{ id: string; source: string }>(
              `SELECT p.id,p.source FROM placements p JOIN slots s ON s.id=p.slot_id JOIN autographs a ON a.id=p.autograph_id
            WHERE s.id=$1 AND s.wall_id=$2 AND p.user_id=$3 AND a.user_id=p.user_id AND a.status='ready'
            ORDER BY p.started_at DESC,p.id DESC LIMIT 1`,
              [input.slotId, input.wallId, userId],
            )
          ).rows[0];
          if (!p) throw new NotificationError('NOT_FOUND');
          placementId = p.id;
          event = p.source === 'takeover' ? 'takeover' : 'slot_claimed';
        } else if (
          wall.status !== 'ended' ||
          (wall.owner_user_id !== userId &&
            !(
              await db.query(
                `SELECT 1 FROM placements p JOIN slots s ON s.id=p.slot_id WHERE s.wall_id=$1 AND p.user_id=$2 LIMIT 1`,
                [input.wallId, userId],
              )
            ).rowCount)
        )
          throw new NotificationError('NOT_FOUND');
        const r = await db.query<{ id: string }>(
          'INSERT INTO share_links (user_id,wall_id,slot_id,placement_id,public_alias,event) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
          [
            userId,
            input.wallId,
            input.slotId ?? null,
            placementId,
            input.slotId ? (input.publicAlias ?? null) : null,
            event,
          ],
        );
        const result = await publicShare(db, r.rows[0]!.id);
        if (!result) throw new NotificationError('NOT_FOUND');
        await db.query('COMMIT');
        return result;
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      } finally {
        db.release();
      }
    },
    async revoke(userId, id) {
      if (
        !(
          await pool.query(
            'UPDATE share_links SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE id=$1 AND user_id=$2',
            [id, userId],
          )
        ).rowCount
      )
        throw new NotificationError('NOT_FOUND');
    },
    async interact(id, kind, dedupeKey) {
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        // Fixed, persistent per-share budget; no IP, User ID, user-agent or referrer.
        await db.query('SELECT id FROM share_links WHERE id=$1 FOR UPDATE', [
          id,
        ]);
        if (!(await publicShare(db, id)))
          throw new NotificationError('NOT_FOUND');
        const count = await db.query<{ n: number }>(
          "SELECT count(*)::int n FROM share_interactions WHERE share_id=$1 AND created_at>clock_timestamp()-interval '1 hour'",
          [id],
        );
        const duplicate = await db.query(
          'SELECT 1 FROM share_interactions WHERE share_id=$1 AND kind=$2 AND dedupe_key=$3',
          [id, kind, dedupeKey],
        );
        if (!duplicate.rowCount && count.rows[0]!.n >= 300)
          throw new NotificationError('RATE_LIMITED');
        await db.query(
          'INSERT INTO share_interactions (share_id,kind,dedupe_key) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [id, kind, dedupeKey],
        );
        await db.query('COMMIT');
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      } finally {
        db.release();
      }
    },
  };
}
