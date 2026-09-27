import { AutographError } from '@digital-autograph/autographs';
import type { AutographStatus } from '@digital-autograph/domain';
import type { Pool, PoolClient } from 'pg';

type Db = Pool | PoolClient;
export type EvidenceAutograph = {
  id: string;
  user_id: string;
  status: AutographStatus;
};
export type ApprovalEvidence = {
  id: string;
  autograph_id: string;
  user_id: string;
  cleaned_asset_id: string;
  approved_at: Date;
};
export type CleanedEvidence = { id: string; storage_key: string };
export type ModerationEvidence = {
  id: string;
  autograph_id: string;
  user_approval_id: string;
  cleaned_asset_id: string;
  decision: 'approved' | 'rejected';
  reason_code: string | null;
  decided_at: Date;
};

export async function readApproval(db: Db, autographId: string) {
  const result = await db.query<ApprovalEvidence>(
    `SELECT id, autograph_id, user_id, cleaned_asset_id, approved_at
     FROM autograph_user_approvals WHERE autograph_id = $1::uuid`,
    [autographId],
  );
  return result.rows[0] ?? null;
}

export async function readCleaned(db: Db, autographId: string, lock = false) {
  const result = await db.query<CleanedEvidence>(
    `SELECT id, storage_key FROM autograph_assets
     WHERE autograph_id = $1::uuid AND role = 'cleaned' AND status = 'uploaded'
     ${lock ? 'FOR SHARE' : ''}`,
    [autographId],
  );
  return result.rows[0] ?? null;
}

export async function readModeration(db: Db, autographId: string) {
  const result = await db.query<ModerationEvidence>(
    `SELECT id, autograph_id, user_approval_id, cleaned_asset_id,
            decision, reason_code, decided_at
     FROM autograph_moderation_decisions WHERE autograph_id = $1::uuid`,
    [autographId],
  );
  return result.rows[0] ?? null;
}

export async function verifyAutographEvidence(
  db: Db,
  autograph: EvidenceAutograph,
  lockCleaned = false,
) {
  const approval = await readApproval(db, autograph.id);
  const moderation = await readModeration(db, autograph.id);
  const final =
    autograph.status === 'ready' || autograph.status === 'moderation_rejected';
  const requiresApproval = final || autograph.status === 'awaiting_moderation';
  const cleaned = requiresApproval
    ? await readCleaned(db, autograph.id, lockCleaned)
    : null;
  if (requiresApproval) {
    if (
      !approval ||
      approval.user_id !== autograph.user_id ||
      approval.cleaned_asset_id !== cleaned?.id
    ) {
      throw new AutographError(
        final ? 'MODERATION_STATE_INCONSISTENT' : 'APPROVAL_STATE_INCONSISTENT',
      );
    }
  } else if (approval) {
    throw new AutographError('APPROVAL_STATE_INCONSISTENT');
  }
  if (final) {
    if (
      !moderation ||
      moderation.user_approval_id !== approval?.id ||
      moderation.cleaned_asset_id !== cleaned?.id ||
      moderation.decision !==
        (autograph.status === 'ready' ? 'approved' : 'rejected')
    ) {
      throw new AutographError('MODERATION_STATE_INCONSISTENT');
    }
  } else if (moderation) {
    throw new AutographError('MODERATION_STATE_INCONSISTENT');
  }
  return { approval, cleaned, moderation };
}
