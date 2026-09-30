import type {
  PlacementHistoryRepository,
  PlacementHistoryRow,
  PlacementSource,
} from '@digital-autograph/walls';
import type { Pool } from 'pg';

type PlacementHistoryDbRow = {
  wall_id: string;
  wall_slug: string;
  wall_display_name: string;
  slot_position: number;
  source: PlacementSource;
  started_at: Date;
  ended_at: Date | null;
  end_reason: string | null;
};

const historyLimit = 100;

function mapRecord(row: PlacementHistoryDbRow): PlacementHistoryRow {
  return {
    wallId: row.wall_id,
    wallSlug: row.wall_slug,
    wallDisplayName: row.wall_display_name,
    slotPosition: row.slot_position,
    source: row.source,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    endReason: row.end_reason,
  };
}

export function createPgPlacementHistoryRepository(
  pool: Pool,
): PlacementHistoryRepository {
  return {
    async listPublicWallHistory(wallId) {
      const result = await pool.query<PlacementHistoryDbRow>(
        `SELECT w.id AS wall_id, cp.slug AS wall_slug,
                cp.display_name AS wall_display_name, s.position AS slot_position,
                p.source, p.started_at, p.ended_at, p.end_reason
         FROM walls w
         JOIN creator_profiles cp ON cp.creator_id = w.creator_id
         LEFT JOIN slots s ON s.wall_id = w.id
         LEFT JOIN placements p ON p.slot_id = s.id
         WHERE w.id = $1::uuid
           AND w.status IN ('scheduled', 'live', 'paused', 'ended')
         ORDER BY p.started_at DESC NULLS LAST, p.id DESC NULLS LAST
         LIMIT $2::integer`,
        [wallId, historyLimit],
      );
      if (!result.rows.length) return null;
      return result.rows
        .filter((row) => row.source !== null && row.started_at !== null)
        .map(mapRecord);
    },

    async listUserHistory(userId) {
      const result = await pool.query<PlacementHistoryDbRow>(
        `SELECT w.id AS wall_id, cp.slug AS wall_slug,
                cp.display_name AS wall_display_name, s.position AS slot_position,
                p.source, p.started_at, p.ended_at, p.end_reason
         FROM placements p
         JOIN slots s ON s.id = p.slot_id
         JOIN walls w ON w.id = s.wall_id
         JOIN creator_profiles cp ON cp.creator_id = w.creator_id
         WHERE p.user_id = $1::uuid
         ORDER BY p.started_at DESC, p.id DESC
         LIMIT $2::integer`,
        [userId, historyLimit],
      );
      return result.rows.map(mapRecord);
    },
  };
}
