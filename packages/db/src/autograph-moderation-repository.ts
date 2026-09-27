import {
  AutographError,
  type ModerationRepository,
  type ModerationRequest,
  type ModerationResult,
} from '@digital-autograph/autographs';
import type {
  AutographSource,
  AutographStatus,
  ModerationRejectionReason,
} from '@digital-autograph/domain';
import type { Pool, PoolClient } from 'pg';
import {
  verifyAutographEvidence,
  type ModerationEvidence,
} from './autograph-evidence';

type AutographRow = {
  id: string;
  user_id: string;
  source: AutographSource;
  status: AutographStatus;
  created_at: Date;
};
type QueueRow = {
  id: string;
  source: AutographSource;
  approved_at: Date;
  created_at: Date;
};

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

export async function requirePlatformRole(
  db: Pool | PoolClient,
  userId: string,
): Promise<void> {
  const role = await db.query(
    `SELECT 1 FROM user_roles r JOIN users u ON u.id = r.user_id
     WHERE r.user_id = $1::uuid AND r.role IN ('moderator', 'admin')
       AND u.status = 'active' LIMIT 1`,
    [userId],
  );
  if (!role.rows[0]) throw new AutographError('FORBIDDEN');
}

async function autograph(db: PoolClient, autographId: string, lock: boolean) {
  const result = await db.query<AutographRow>(
    `SELECT id, user_id, source, status, created_at FROM autographs
     WHERE id = $1::uuid ${lock ? 'FOR UPDATE' : ''}`,
    [autographId],
  );
  const row = result.rows[0];
  if (!row) throw new AutographError('AUTOGRAPH_NOT_FOUND');
  return row;
}

function resultFromEvidence(
  id: string,
  evidence: ModerationEvidence,
): ModerationResult {
  return {
    id,
    status: evidence.decision === 'approved' ? 'ready' : 'moderation_rejected',
    decision: evidence.decision,
    reasonCode: evidence.reason_code as ModerationRejectionReason | null,
    decidedAt: evidence.decided_at,
  };
}

export function createPgAutographModerationRepository(
  pool: Pool,
): ModerationRepository {
  return {
    async list(moderatorUserId, limit, cursor) {
      await requirePlatformRole(pool, moderatorUserId);
      if (cursor) {
        const anchor = await pool.query(
          `SELECT 1 FROM autograph_user_approvals
           WHERE autograph_id = $1::uuid`,
          [cursor],
        );
        if (!anchor.rows[0]) throw new AutographError('INVALID_CURSOR');
      }
      const rows = await pool.query<QueueRow>(
        `SELECT a.id, a.source, u.approved_at, a.created_at
         FROM autographs a
         JOIN autograph_user_approvals u ON u.autograph_id = a.id
         JOIN autograph_assets x ON x.id = u.cleaned_asset_id
           AND x.autograph_id = a.id AND x.role = 'cleaned'
           AND x.status = 'uploaded'
         WHERE a.status = 'awaiting_moderation'
           AND a.user_id = u.user_id
           AND NOT EXISTS (SELECT 1 FROM autograph_moderation_decisions m
                           WHERE m.autograph_id = a.id)
           AND ($1::uuid IS NULL OR (u.approved_at, a.id) > (
              SELECT approved_at, autograph_id FROM autograph_user_approvals
              WHERE autograph_id = $1::uuid))
         ORDER BY u.approved_at ASC, a.id ASC LIMIT $2::integer`,
        [cursor ?? null, limit + 1],
      );
      const items = rows.rows.slice(0, limit).map((row) => ({
        id: row.id,
        source: row.source,
        approvedAt: row.approved_at,
        createdAt: row.created_at,
      }));
      return {
        items,
        nextCursor:
          rows.rows.length > limit ? (items.at(-1)?.id ?? null) : null,
      };
    },

    async previewTarget(moderatorUserId, autographId) {
      return withTransaction(pool, async (client) => {
        await requirePlatformRole(client, moderatorUserId);
        const row = await autograph(client, autographId, true);
        if (row.status !== 'awaiting_moderation') {
          throw new AutographError('MODERATION_NOT_AWAITING');
        }
        const { cleaned } = await verifyAutographEvidence(client, row, true);
        if (!cleaned) throw new AutographError('APPROVAL_STATE_INCONSISTENT');
        return { key: cleaned.storage_key };
      });
    },

    async decide(moderatorUserId, autographId, request: ModerationRequest) {
      return withTransaction(pool, async (client) => {
        await requirePlatformRole(client, moderatorUserId);
        const row = await autograph(client, autographId, true);
        const evidence = await verifyAutographEvidence(client, row, true);
        if (row.status === 'ready' || row.status === 'moderation_rejected') {
          if (
            evidence.moderation?.decision !== request.decision ||
            (request.decision === 'rejected' &&
              evidence.moderation.reason_code !== request.reasonCode)
          ) {
            throw new AutographError('MODERATION_ALREADY_DECIDED');
          }
          return resultFromEvidence(row.id, evidence.moderation);
        }
        if (row.status !== 'awaiting_moderation') {
          throw new AutographError('MODERATION_NOT_AWAITING');
        }
        if (!evidence.approval || !evidence.cleaned) {
          throw new AutographError('APPROVAL_STATE_INCONSISTENT');
        }
        const inserted = await client.query<ModerationEvidence>(
          `INSERT INTO autograph_moderation_decisions
             (autograph_id, moderator_user_id, user_approval_id,
              cleaned_asset_id, decision, reason_code)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid,
                   $5::autograph_moderation_decision,
                   $6::autograph_moderation_reason)
           RETURNING id, autograph_id, user_approval_id, cleaned_asset_id,
                     decision, reason_code, decided_at`,
          [
            row.id,
            moderatorUserId,
            evidence.approval.id,
            evidence.cleaned.id,
            request.decision,
            request.decision === 'rejected' ? request.reasonCode : null,
          ],
        );
        const nextStatus =
          request.decision === 'approved' ? 'ready' : 'moderation_rejected';
        const updated = await client.query(
          `UPDATE autographs SET status = $2::autograph_status,
             updated_at = now()
           WHERE id = $1::uuid AND status = 'awaiting_moderation'`,
          [row.id, nextStatus],
        );
        const decision = inserted.rows[0];
        if (updated.rowCount !== 1 || !decision) {
          throw new AutographError('MODERATION_STATE_INCONSISTENT');
        }
        return resultFromEvidence(row.id, decision);
      });
    },
  };
}
