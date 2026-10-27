import { AutographError } from '@digital-autograph/autographs';
import {
  isAutographPlacementEligible,
  type AutographStatus,
} from '@digital-autograph/domain';
import type {
  PublicPlacementMediaRepository,
  PublicPlacementMediaResolution,
} from '@digital-autograph/walls';
import type { Pool } from 'pg';
import { verifyAutographEvidence } from './autograph-evidence';

type PlacementRow = { autograph_id: string | null; user_id: string };
type AutographRow = {
  id: string;
  user_id: string;
  status: AutographStatus;
};

export function createPgPublicPlacementMediaRepository(
  pool: Pool,
): PublicPlacementMediaRepository {
  return {
    async resolveActive(placementId): Promise<PublicPlacementMediaResolution> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const placement = await client.query<PlacementRow>(
          `SELECT p.user_id, p.autograph_id FROM placements p
           JOIN slots s ON s.id = p.slot_id
           JOIN walls w ON w.id = s.wall_id
           WHERE p.id = $1::uuid AND p.ended_at IS NULL
             AND w.status IN ('scheduled', 'live', 'paused', 'ended')
           FOR SHARE OF p, w`,
          [placementId],
        );
        const row = placement.rows[0];
        if (!row) {
          await client.query('COMMIT');
          return { kind: 'not_found' };
        }
        if (!row.autograph_id) {
          await client.query('COMMIT');
          return { kind: 'inconsistent' };
        }
        const autograph = await client.query<AutographRow>(
          `SELECT id, user_id, status FROM autographs
           WHERE id = $1::uuid FOR SHARE`,
          [row.autograph_id],
        );
        const selected = autograph.rows[0];
        if (
          !selected ||
          selected.user_id !== row.user_id ||
          !isAutographPlacementEligible(selected.status)
        ) {
          await client.query('COMMIT');
          return { kind: 'inconsistent' };
        }
        let cleaned: Awaited<
          ReturnType<typeof verifyAutographEvidence>
        >['cleaned'];
        try {
          ({ cleaned } = await verifyAutographEvidence(client, selected, true));
        } catch (error) {
          if (!(error instanceof AutographError)) throw error;
          await client.query('COMMIT');
          return { kind: 'inconsistent' };
        }
        if (!cleaned) {
          await client.query('COMMIT');
          return { kind: 'inconsistent' };
        }
        const asset = await client.query<{
          verified_size_bytes: number | null;
          actual_content_type: string | null;
          width: number | null;
          height: number | null;
        }>(
          `SELECT verified_size_bytes, actual_content_type, width, height
           FROM autograph_assets WHERE id = $1::uuid`,
          [cleaned.id],
        );
        const metadata = asset.rows[0];
        if (
          metadata?.actual_content_type !== 'image/png' ||
          !metadata.verified_size_bytes ||
          metadata.verified_size_bytes > 10 * 1024 * 1024 ||
          !metadata.width ||
          metadata.width > 2048 ||
          !metadata.height ||
          metadata.height > 2048
        ) {
          await client.query('COMMIT');
          return { kind: 'inconsistent' };
        }
        await client.query('COMMIT');
        return {
          kind: 'available',
          storageKey: cleaned.storage_key,
          verifiedSizeBytes: metadata.verified_size_bytes,
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
