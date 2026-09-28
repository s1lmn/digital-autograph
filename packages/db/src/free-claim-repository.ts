import { AutographError } from '@digital-autograph/autographs';
import {
  isAutographPlacementEligible,
  isWallFreeClaimEligible,
  type AutographStatus,
  type WallStatus,
} from '@digital-autograph/domain';
import {
  FreeClaimError,
  type FreeClaimInput,
  type FreeClaimRepository,
  type FreeClaimResult,
} from '@digital-autograph/walls';
import type { Pool, PoolClient } from 'pg';
import { verifyAutographEvidence } from './autograph-evidence';

type WallRow = {
  status: WallStatus;
  start_at: Date | null;
  end_at: Date | null;
};
type ClaimRow = {
  id: string;
  wall_id: string;
  slot_id: string;
  autograph_id: string;
  placement_id: string;
  started_at: Date;
};
type PgError = Error & { code?: string; constraint?: string };

function result(row: ClaimRow, created: boolean): FreeClaimResult {
  return {
    created,
    claimId: row.id,
    wallId: row.wall_id,
    slotId: row.slot_id,
    autographId: row.autograph_id,
    placement: {
      id: row.placement_id,
      source: 'free_claim',
      startedAt: row.started_at,
    },
  };
}

async function existingClaim(
  db: Pool | PoolClient,
  wallId: string,
  userId: string,
): Promise<ClaimRow | null> {
  const found = await db.query<ClaimRow>(
    `SELECT fc.id, fc.wall_id, fc.slot_id, fc.autograph_id,
            fc.placement_id, p.started_at
     FROM wall_free_claims fc
     JOIN placements p ON p.id = fc.placement_id
     WHERE fc.wall_id = $1::uuid AND fc.user_id = $2::uuid`,
    [wallId, userId],
  );
  return found.rows[0] ?? null;
}

function replay(row: ClaimRow, input: FreeClaimInput): FreeClaimResult {
  if (row.slot_id !== input.slotId || row.autograph_id !== input.autographId) {
    throw new FreeClaimError('FREE_CLAIM_ALREADY_USED');
  }
  return result(row, false);
}

async function claimInTransaction(
  client: PoolClient,
  input: FreeClaimInput,
  afterPlacementInsert?: () => Promise<void>,
): Promise<FreeClaimResult> {
  // Wall SHARE is compatible with other claims, but conflicts with lifecycle UPDATE.
  const wall = await client.query<WallRow>(
    'SELECT status, start_at, end_at FROM walls WHERE id = $1::uuid FOR SHARE',
    [input.wallId],
  );
  if (!wall.rows[0]) throw new FreeClaimError('WALL_NOT_FOUND');

  const slot = await client.query<{ wall_id: string }>(
    'SELECT wall_id FROM slots WHERE id = $1::uuid FOR UPDATE',
    [input.slotId],
  );
  if (!slot.rows[0]) throw new FreeClaimError('SLOT_NOT_FOUND');
  if (slot.rows[0].wall_id !== input.wallId) {
    throw new FreeClaimError('SLOT_NOT_IN_WALL');
  }

  const prior = await existingClaim(client, input.wallId, input.userId);
  if (prior) return replay(prior, input);
  if (wall.rows[0].status !== 'live') {
    throw new FreeClaimError('WALL_NOT_CLAIMABLE');
  }

  const occupied = await client.query(
    'SELECT 1 FROM placements WHERE slot_id = $1::uuid AND ended_at IS NULL',
    [input.slotId],
  );
  if (occupied.rowCount) throw new FreeClaimError('SLOT_OCCUPIED');

  const autograph = await client.query<{
    id: string;
    user_id: string;
    status: AutographStatus;
  }>(
    'SELECT id, user_id, status FROM autographs WHERE id = $1::uuid FOR SHARE',
    [input.autographId],
  );
  const selected = autograph.rows[0];
  if (!selected || selected.user_id !== input.userId) {
    throw new FreeClaimError('AUTOGRAPH_NOT_FOUND');
  }
  if (!isAutographPlacementEligible(selected.status)) {
    throw new FreeClaimError('AUTOGRAPH_NOT_READY');
  }
  try {
    await verifyAutographEvidence(client, selected, true);
  } catch (error) {
    if (error instanceof AutographError) {
      throw new FreeClaimError('AUTOGRAPH_EVIDENCE_INCONSISTENT');
    }
    throw error;
  }

  // Sample after all row-lock waits, including Autograph/Asset verification.
  // transaction_timestamp would retain the pre-wait instant and could admit a
  // claim after end_at. Use the same instant for eligibility and both rows.
  const nowResult = await client.query<{ now: Date }>(
    'SELECT clock_timestamp() AS now',
  );
  const now = nowResult.rows[0]?.now;
  if (!now) throw new Error('PostgreSQL clock unavailable');
  if (
    !isWallFreeClaimEligible(
      {
        status: wall.rows[0].status,
        startAt: wall.rows[0].start_at,
        endAt: wall.rows[0].end_at,
      },
      now,
    )
  ) {
    throw new FreeClaimError('WALL_NOT_CLAIMABLE');
  }

  const placement = await client.query<{ id: string }>(
    `INSERT INTO placements
       (slot_id, user_id, autograph_id, source, started_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'free_claim', $4::timestamptz)
     RETURNING id`,
    [input.slotId, input.userId, input.autographId, now],
  );
  const placementId = placement.rows[0]?.id;
  if (!placementId) throw new Error('Placement insert returned no ID');
  await afterPlacementInsert?.();
  const claim = await client.query<{ id: string }>(
    `INSERT INTO wall_free_claims
       (wall_id, slot_id, user_id, autograph_id, placement_id, claimed_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::timestamptz)
     RETURNING id`,
    [
      input.wallId,
      input.slotId,
      input.userId,
      input.autographId,
      placementId,
      now,
    ],
  );
  const claimId = claim.rows[0]?.id;
  if (!claimId) throw new Error('Free Claim insert returned no ID');
  return {
    created: true,
    claimId,
    wallId: input.wallId,
    slotId: input.slotId,
    autographId: input.autographId,
    placement: { id: placementId, source: 'free_claim', startedAt: now },
  };
}

export function createPgFreeClaimRepository(
  pool: Pool,
  options: { afterPlacementInsert?: () => Promise<void> } = {},
): FreeClaimRepository {
  return {
    async claimFreeSlot(input) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const claimed = await claimInTransaction(
          client,
          input,
          options.afterPlacementInsert,
        );
        await client.query('COMMIT');
        return claimed;
      } catch (error) {
        await client.query('ROLLBACK');
        const pgError = error as PgError;
        if (
          pgError.code === '23505' &&
          pgError.constraint === 'wall_free_claims_wall_user_uidx'
        ) {
          const prior = await existingClaim(client, input.wallId, input.userId);
          if (prior) return replay(prior, input);
          throw new FreeClaimError('FREE_CLAIM_ALREADY_USED');
        }
        if (
          pgError.code === '23505' &&
          pgError.constraint === 'placements_one_active_per_slot_uidx'
        ) {
          throw new FreeClaimError('SLOT_OCCUPIED');
        }
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
