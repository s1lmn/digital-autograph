import { isPublicWall, type WallStatus } from '@digital-autograph/domain';
import {
  WallError,
  type PublicCreator,
  type PublicWall,
  type SlotStructure,
  type WallMutation,
  type WallRepository,
  type WallSnapshot,
} from '@digital-autograph/walls';
import type { Pool, PoolClient } from 'pg';

type WallRow = {
  id: string;
  creator_id: string;
  status: WallStatus;
  slot_count: number;
  start_at: Date | null;
  end_at: Date | null;
  owner_user_id: string | null;
};

type SlotRow = { id: string; position: number };

type PublicWallRow = {
  id: string;
  creator_id: string;
  slug: string;
  display_name: string;
  status: WallStatus;
  start_at: Date | null;
  end_at: Date | null;
  slot_count: number;
  slot_id: string | null;
  position: number | null;
  placement_id: string | null;
  placement_source: 'free_claim' | 'takeover' | 'admin' | null;
  placement_started_at: Date | null;
  media_available: boolean;
};

function assertSlotStructure(
  slotCount: number,
  slots: readonly SlotStructure[],
): void {
  if (
    slots.length !== slotCount ||
    slots.some((slot, position) => slot.position !== position)
  ) {
    throw new Error('Wall slot structure is inconsistent');
  }
}

async function withTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function ownerForCreator(
  client: PoolClient,
  creatorId: string,
  actorUserId: string,
): Promise<void> {
  const found = await client.query<{ owner_user_id: string | null }>(
    'SELECT owner_user_id FROM creators WHERE id = $1::uuid FOR SHARE',
    [creatorId],
  );
  const creator = found.rows[0];
  if (!creator) throw new WallError('CREATOR_NOT_FOUND');
  if (creator.owner_user_id !== actorUserId) throw new WallError('FORBIDDEN');
}

async function lockedSnapshot(
  client: PoolClient,
  row: WallRow,
): Promise<WallSnapshot> {
  const slotResult = await client.query<SlotRow>(
    'SELECT id, position FROM slots WHERE wall_id = $1::uuid ORDER BY position FOR UPDATE',
    [row.id],
  );
  const slots = slotResult.rows;
  assertSlotStructure(row.slot_count, slots);
  const history = await client.query<{ has_history: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM placements p
       JOIN slots s ON s.id = p.slot_id
       WHERE s.wall_id = $1::uuid
     ) AS has_history`,
    [row.id],
  );
  return {
    id: row.id,
    creatorId: row.creator_id,
    status: row.status,
    slotCount: row.slot_count,
    startAt: row.start_at,
    endAt: row.end_at,
    slots,
    hasHistory: history.rows[0]?.has_history ?? false,
  };
}

export function createPgWallRepository(pool: Pool): WallRepository {
  return {
    async findCreatorOwner(creatorId) {
      const found = await pool.query<{ owner_user_id: string | null }>(
        'SELECT owner_user_id FROM creators WHERE id = $1::uuid',
        [creatorId],
      );
      return found.rows[0]?.owner_user_id;
    },

    async findPublicCreator(slug): Promise<PublicCreator | null> {
      const profile = await pool.query<{
        id: string;
        slug: string;
        display_name: string;
      }>(
        `SELECT c.id, cp.slug, cp.display_name
         FROM creator_profiles cp JOIN creators c ON c.id = cp.creator_id
         WHERE cp.slug = $1`,
        [slug],
      );
      const row = profile.rows[0];
      if (!row) return null;
      const walls = await pool.query<{
        id: string;
        status: WallStatus;
        start_at: Date | null;
        end_at: Date | null;
      }>(
        `SELECT id, status, start_at, end_at FROM walls
         WHERE creator_id = $1::uuid
           AND status IN ('scheduled', 'live', 'paused', 'ended')
         ORDER BY created_at DESC, id DESC`,
        [row.id],
      );
      return {
        id: row.id,
        slug: row.slug,
        displayName: row.display_name,
        walls: walls.rows.map((wall) => ({
          id: wall.id,
          status: wall.status,
          startAt: wall.start_at,
          endAt: wall.end_at,
        })),
      };
    },

    async findPublicWall(wallId): Promise<PublicWall | null> {
      const result = await pool.query<PublicWallRow>(
        `SELECT w.id, w.status, w.start_at, w.end_at, w.slot_count,
                c.id AS creator_id, cp.slug, cp.display_name,
                s.id AS slot_id, s.position,
                p.id AS placement_id, p.source AS placement_source,
                p.started_at AS placement_started_at,
                CASE WHEN p.id IS NOT NULL
                  AND p.autograph_id IS NOT NULL
                  AND p.user_id = a.user_id
                  AND a.status = 'ready'
                  AND ua.user_id = a.user_id
                  AND ua.cleaned_asset_id = ca.id
                  AND md.user_approval_id = ua.id
                  AND md.cleaned_asset_id = ca.id
                  AND md.decision = 'approved'
                  AND ca.actual_content_type = 'image/png'
                  AND ca.verified_size_bytes BETWEEN 1 AND 10485760
                  AND ca.width BETWEEN 1 AND 2048
                  AND ca.height BETWEEN 1 AND 2048
                  THEN true ELSE false END AS media_available
         FROM walls w
         JOIN creators c ON c.id = w.creator_id
         JOIN creator_profiles cp ON cp.creator_id = c.id
         LEFT JOIN slots s ON s.wall_id = w.id
         LEFT JOIN placements p ON p.slot_id = s.id AND p.ended_at IS NULL
         LEFT JOIN autographs a ON a.id = p.autograph_id
         LEFT JOIN autograph_user_approvals ua ON ua.autograph_id = a.id
         LEFT JOIN autograph_assets ca ON ca.autograph_id = a.id
           AND ca.role = 'cleaned' AND ca.status = 'uploaded'
         LEFT JOIN autograph_moderation_decisions md ON md.autograph_id = a.id
         WHERE w.id = $1::uuid
           AND w.status IN ('scheduled', 'live', 'paused', 'ended')
         ORDER BY s.position`,
        [wallId],
      );
      const first = result.rows[0];
      if (!first || !isPublicWall(first.status)) return null;
      const slots = result.rows.flatMap((row) =>
        row.slot_id === null || row.position === null
          ? []
          : [
              {
                id: row.slot_id,
                position: row.position,
                occupied: row.placement_id !== null,
                currentPlacement:
                  row.placement_id &&
                  row.placement_source &&
                  row.placement_started_at
                    ? {
                        id: row.placement_id,
                        source: row.placement_source,
                        startedAt: row.placement_started_at,
                        mediaPath: row.media_available
                          ? `/public/placements/${row.placement_id}/autograph`
                          : null,
                      }
                    : null,
              },
            ],
      );
      assertSlotStructure(first.slot_count, slots);
      return {
        id: first.id,
        status: first.status,
        startAt: first.start_at,
        endAt: first.end_at,
        slotCount: first.slot_count,
        creator: {
          id: first.creator_id,
          slug: first.slug,
          displayName: first.display_name,
        },
        slots,
      };
    },

    async createOwnedWall(actorUserId, creatorId, input) {
      return withTransaction(pool, async (client) => {
        await ownerForCreator(client, creatorId, actorUserId);
        const created = await client.query<WallRow>(
          `INSERT INTO walls (creator_id, status, slot_count, start_at, end_at)
           VALUES ($1::uuid, 'draft', $2::integer, $3::timestamptz, $4::timestamptz)
           RETURNING id, creator_id, status, slot_count, start_at, end_at`,
          [creatorId, input.slotCount, input.startAt, input.endAt],
        );
        const row = created.rows[0];
        if (!row) throw new Error('Wall insertion returned no row');
        await client.query(
          `INSERT INTO slots (wall_id, position)
           SELECT $1::uuid, position
           FROM generate_series(0, $2::integer - 1) AS position`,
          [row.id, input.slotCount],
        );
        return lockedSnapshot(client, row);
      });
    },

    async mutateOwnedWall(
      actorUserId: string,
      wallId: string,
      decide: (current: WallSnapshot) => WallMutation,
    ) {
      return withTransaction(pool, async (client) => {
        const found = await client.query<WallRow>(
          `SELECT w.id, w.creator_id, w.status, w.slot_count, w.start_at,
                  w.end_at, c.owner_user_id
           FROM walls w JOIN creators c ON c.id = w.creator_id
           WHERE w.id = $1::uuid
           FOR UPDATE OF w, c`,
          [wallId],
        );
        const row = found.rows[0];
        if (!row) throw new WallError('WALL_NOT_FOUND');
        if (row.owner_user_id !== actorUserId) {
          throw new WallError('FORBIDDEN');
        }
        const current = await lockedSnapshot(client, row);
        const mutation = decide(current);
        const slotCount = mutation.slotCount ?? current.slotCount;
        const startAt =
          mutation.startAt === undefined ? current.startAt : mutation.startAt;
        const endAt =
          mutation.endAt === undefined ? current.endAt : mutation.endAt;
        const status = mutation.status ?? current.status;
        if (slotCount > current.slotCount) {
          await client.query(
            `INSERT INTO slots (wall_id, position)
             SELECT $1::uuid, position
             FROM generate_series($2::integer, $3::integer - 1) AS position`,
            [wallId, current.slotCount, slotCount],
          );
        } else if (slotCount < current.slotCount) {
          await client.query(
            'DELETE FROM slots WHERE wall_id = $1::uuid AND position >= $2::integer',
            [wallId, slotCount],
          );
        }
        const updated = await client.query<WallRow>(
          `UPDATE walls SET status = $2::wall_status,
             slot_count = $3::integer, start_at = $4::timestamptz,
             end_at = $5::timestamptz
           WHERE id = $1::uuid
           RETURNING id, creator_id, status, slot_count, start_at, end_at`,
          [wallId, status, slotCount, startAt, endAt],
        );
        const next = updated.rows[0];
        if (!next) throw new Error('Wall update returned no row');
        return lockedSnapshot(client, next);
      });
    },
  };
}
