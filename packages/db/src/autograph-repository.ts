import {
  AutographError,
  type AutographRepository,
  type AutographView,
  type OriginalContentType,
  type ReservedOriginal,
} from '@digital-autograph/autographs';
import type {
  AutographSource,
  AutographStatus,
} from '@digital-autograph/domain';
import type { Pool, PoolClient } from 'pg';
import {
  readApproval,
  readCleaned,
  verifyAutographEvidence,
} from './autograph-evidence';

type AutographRow = {
  id: string;
  user_id: string;
  source: AutographSource;
  status: AutographStatus;
  created_at: Date;
  updated_at: Date;
};

type AssetRow = {
  id: string;
  autograph_id: string;
  storage_key: string;
  status: 'reserved' | 'uploaded';
  expected_content_type: OriginalContentType;
  expected_size_bytes: number;
  verified_size_bytes: number | null;
  upload_expires_at: Date;
  uploaded_at: Date | null;
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
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === '55P03'
    )
      throw new AutographError('UPLOAD_BUSY');
    throw error;
  } finally {
    client.release();
  }
}

async function ownedAutograph(
  db: Pool | PoolClient,
  userId: string,
  autographId: string,
  lock = false,
): Promise<AutographRow> {
  const found = await db.query<AutographRow>(
    `SELECT id, user_id, source, status, created_at, updated_at
     FROM autographs WHERE id = $1::uuid ${lock ? 'FOR UPDATE' : ''}`,
    [autographId],
  );
  const row = found.rows[0];
  if (!row) throw new AutographError('AUTOGRAPH_NOT_FOUND');
  if (row.user_id !== userId) throw new AutographError('FORBIDDEN');
  return row;
}

async function originalAsset(
  db: Pool | PoolClient,
  autographId: string,
): Promise<AssetRow | null> {
  const found = await db.query<AssetRow>(
    `SELECT id, autograph_id, storage_key, status, expected_content_type,
            expected_size_bytes, verified_size_bytes, upload_expires_at, uploaded_at
     FROM autograph_assets WHERE autograph_id = $1::uuid AND role = 'original'`,
    [autographId],
  );
  return found.rows[0] ?? null;
}

function toReserved(asset: AssetRow): ReservedOriginal {
  return {
    id: asset.id,
    autographId: asset.autograph_id,
    storageKey: asset.storage_key,
    expectedContentType: asset.expected_content_type,
    expectedSizeBytes: asset.expected_size_bytes,
    uploadExpiresAt: asset.upload_expires_at,
    status: asset.status,
  };
}

async function view(
  db: Pool | PoolClient,
  row: AutographRow,
): Promise<AutographView> {
  const asset = await originalAsset(db, row.id);
  const { approval: approved, moderation } = await verifyAutographEvidence(
    db,
    row,
  );
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: approved?.approved_at ?? null,
    moderation: moderation
      ? {
          decision: moderation.decision,
          reasonCode: moderation.reason_code,
          decidedAt: moderation.decided_at,
        }
      : null,
    original: asset
      ? {
          id: asset.id,
          status: asset.status,
          expectedContentType: asset.expected_content_type,
          expectedSizeBytes: asset.expected_size_bytes,
          verifiedSizeBytes: asset.verified_size_bytes,
          uploadExpiresAt: asset.upload_expires_at,
          uploadedAt: asset.uploaded_at,
        }
      : null,
  };
}

// Fixed engineering resource caps, shared by every API process through PostgreSQL.
export const autographResourceLimits = {
  owned: 100,
  createsPerHour: 20,
  globalCreatesPerHour: 2000,
  pending: 3,
  globalPending: 300,
  retiredKeyBudget: 10000,
  parallelIo: 4,
  uploadAttempts: 5,
} as const;

async function quotaGate(client: PoolClient): Promise<void> {
  // A short, bounded-wait global admission lock; never held during storage I/O.
  await client.query("SET LOCAL lock_timeout = '2s'");
  await client.query('SELECT pg_advisory_xact_lock(764210, 0)');
}

async function ioPermit(client: PoolClient): Promise<void> {
  for (let slot = 1; slot <= autographResourceLimits.parallelIo; slot++) {
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_xact_lock(764211, $1) AS acquired',
      [slot],
    );
    if (result.rows[0]?.acquired) return;
  }
  throw new AutographError('UPLOAD_BUSY');
}

export function createPgAutographRepository(pool: Pool): AutographRepository {
  return {
    async listReadyOwned(userId) {
      const found = await pool.query<AutographRow>(
        `SELECT id, user_id, source, status, created_at, updated_at
         FROM autographs
         WHERE user_id = $1::uuid AND status = 'ready'
         ORDER BY created_at DESC, id DESC LIMIT 50`,
        [userId],
      );
      const choices = [];
      for (const row of found.rows) {
        try {
          const { moderation } = await verifyAutographEvidence(pool, row);
          if (moderation?.decision !== 'approved') continue;
          choices.push({
            id: row.id,
            source: row.source,
            createdAt: row.created_at,
            moderatedAt: moderation.decided_at,
          });
          if (choices.length === 30) break;
        } catch (error) {
          if (!(error instanceof AutographError)) throw error;
          console.warn('Ineligible ready Autograph excluded from owner list', {
            autographId: row.id,
          });
        }
      }
      return choices;
    },
    async create(userId, source) {
      return withTransaction(pool, async (client) => {
        await quotaGate(client);
        const counts = await client.query<{
          owned: string;
          recent: string;
          global_recent: string;
        }>(
          `SELECT (SELECT count(*) FROM autographs WHERE user_id = $1::uuid) AS owned,
             (SELECT count(*) FROM autographs WHERE user_id = $1::uuid AND created_at > now() - interval '1 hour') AS recent,
             (SELECT count(*) FROM autographs WHERE created_at > now() - interval '1 hour') AS global_recent`,
          [userId],
        );
        const count = counts.rows[0]!;
        if (
          +count.owned >= autographResourceLimits.owned ||
          +count.recent >= autographResourceLimits.createsPerHour ||
          +count.global_recent >= autographResourceLimits.globalCreatesPerHour
        )
          throw new AutographError('UPLOAD_QUOTA_EXCEEDED');
        const result = await client.query<AutographRow>(
          `INSERT INTO autographs (user_id, source) VALUES ($1::uuid, $2::autograph_source)
           RETURNING id, user_id, source, status, created_at, updated_at`,
          [userId, source],
        );
        const row = result.rows[0];
        if (!row) throw new Error('Autograph insertion returned no row');
        return view(client, row);
      });
    },

    async findOwned(userId, autographId) {
      return withTransaction(pool, async (client) =>
        view(client, await ownedAutograph(client, userId, autographId, true)),
      );
    },

    async reserveOriginal(userId, autographId, input) {
      return withTransaction(pool, async (client) => {
        await quotaGate(client);
        const autograph = await ownedAutograph(
          client,
          userId,
          autographId,
          true,
        );
        const existing = await originalAsset(client, autographId);
        if (existing) {
          if (
            autograph.status !== 'upload_pending' ||
            existing.status !== 'reserved' ||
            existing.expected_content_type !== input.contentType ||
            existing.expected_size_bytes !== input.sizeBytes
          ) {
            throw new AutographError('INVALID_AUTOGRAPH_STATE');
          }
          if (existing.upload_expires_at <= new Date())
            throw new AutographError('UPLOAD_EXPIRED');
          // Retry returns the same reservation; never extends its expiry.
          return toReserved(existing);
        }
        if (autograph.status !== 'draft') {
          throw new AutographError('INVALID_AUTOGRAPH_STATE');
        }
        const counts = await client.query<{
          owned: string;
          total: string;
          retired: string;
          owned_originals: string;
        }>(
          `SELECT count(*) FILTER (WHERE a.user_id = $1::uuid) AS owned, count(*) AS total,
             (SELECT count(*) FROM original_upload_tombstones) AS retired,
             (SELECT count(*) FROM autograph_assets original JOIN autographs owned ON owned.id = original.autograph_id
              WHERE original.role = 'original' AND owned.user_id = $1::uuid) AS owned_originals
           FROM autograph_assets aa JOIN autographs a ON a.id = aa.autograph_id
           WHERE aa.role = 'original' AND aa.status = 'reserved'`,
          [userId],
        );
        if (
          +counts.rows[0]!.owned >= autographResourceLimits.pending ||
          +counts.rows[0]!.owned_originals >= autographResourceLimits.owned ||
          +counts.rows[0]!.total >= autographResourceLimits.globalPending ||
          +counts.rows[0]!.total + +counts.rows[0]!.retired >=
            autographResourceLimits.retiredKeyBudget
        )
          throw new AutographError('UPLOAD_QUOTA_EXCEEDED');
        const inserted = await client.query<AssetRow>(
          `INSERT INTO autograph_assets
             (id, autograph_id, role, status, storage_key, expected_content_type,
              expected_size_bytes, upload_expires_at)
           VALUES ($1::uuid, $2::uuid, 'original', 'reserved', $3, $4, $5, $6::timestamptz)
           RETURNING id, autograph_id, storage_key, status, expected_content_type,
                     expected_size_bytes, verified_size_bytes, upload_expires_at, uploaded_at`,
          [
            input.assetId,
            autographId,
            input.storageKey,
            input.contentType,
            input.sizeBytes,
            input.expiresAt,
          ],
        );
        await client.query(
          "UPDATE autographs SET status = 'upload_pending' WHERE id = $1::uuid",
          [autographId],
        );
        const row = inserted.rows[0];
        if (!row) throw new Error('Asset insertion returned no row');
        return toReserved(row);
      });
    },

    async uploadOriginal(userId, autographId, assetId, write) {
      // Attempts survive rejected/aborted uploads. Ownership is checked before charging.
      await ownedAutograph(pool, userId, autographId);
      const attempt = await pool.query(
        `UPDATE autograph_assets SET upload_attempts = upload_attempts + 1
         WHERE id = $1::uuid AND autograph_id = $2::uuid AND role = 'original'
           AND status = 'reserved' AND upload_expires_at > now() AND upload_attempts < $3`,
        [assetId, autographId, autographResourceLimits.uploadAttempts],
      );
      if (!attempt.rowCount) throw new AutographError('UPLOAD_EXPIRED');
      return withTransaction(pool, async (client) => {
        await ioPermit(client);
        await client.query("SET LOCAL lock_timeout = '2s'");
        // Same lock as completion/cleanup. A02 deliberately retains the existing
        // storage-under-lock protocol; separate A03 replaces it with fencing.
        const autograph = await ownedAutograph(
          client,
          userId,
          autographId,
          true,
        );
        const asset = await originalAsset(client, autographId);
        if (
          !asset ||
          asset.id !== assetId ||
          asset.status !== 'reserved' ||
          autograph.status !== 'upload_pending'
        )
          throw new AutographError('INVALID_AUTOGRAPH_STATE');
        if (asset.upload_expires_at <= new Date())
          throw new AutographError('UPLOAD_EXPIRED');
        await write(toReserved(asset));
      });
    },

    async completionTarget(userId, autographId) {
      const autograph = await ownedAutograph(pool, userId, autographId);
      const asset = await originalAsset(pool, autographId);
      if (
        !asset ||
        (autograph.status !== 'upload_pending' &&
          autograph.status !== 'uploaded_unverified')
      ) {
        throw new AutographError('INVALID_AUTOGRAPH_STATE');
      }
      return toReserved(asset);
    },

    async completeOriginal(userId, autographId, verify) {
      return withTransaction(pool, async (client) => {
        const autograph = await ownedAutograph(
          client,
          userId,
          autographId,
          true,
        );
        const asset = await originalAsset(client, autographId);
        if (!asset) throw new AutographError('INVALID_AUTOGRAPH_STATE');
        if (asset.status === 'uploaded') {
          if (
            ['awaiting_moderation', 'ready', 'moderation_rejected'].includes(
              autograph.status,
            )
          ) {
            throw new AutographError('INVALID_AUTOGRAPH_STATE');
          }
          return view(client, autograph);
        }
        if (
          autograph.status !== 'upload_pending' ||
          asset.status !== 'reserved'
        ) {
          throw new AutographError('INVALID_AUTOGRAPH_STATE');
        }
        await ioPermit(client);
        const actualSizeBytes = await verify(toReserved(asset));
        await client.query(
          `UPDATE autograph_assets SET status = 'uploaded',
             verified_size_bytes = $2::integer, uploaded_at = now()
           WHERE id = $1::uuid`,
          [asset.id, actualSizeBytes],
        );
        const updated = await client.query<AutographRow>(
          `UPDATE autographs SET status = 'uploaded_unverified' WHERE id = $1::uuid
           RETURNING id, user_id, source, status, created_at, updated_at`,
          [autographId],
        );
        const row = updated.rows[0];
        if (!row) throw new Error('Autograph update returned no row');
        await client.query(
          `INSERT INTO autograph_processing_jobs (autograph_id, original_asset_id)
           VALUES ($1::uuid, $2::uuid)`,
          [autographId, asset.id],
        );
        return view(client, row);
      });
    },

    async cleanedAssetPreview(userId, autographId) {
      return withTransaction(pool, async (client) => {
        const autograph = await ownedAutograph(
          client,
          userId,
          autographId,
          true,
        );
        if (
          ![
            'awaiting_approval',
            'awaiting_moderation',
            'ready',
            'moderation_rejected',
          ].includes(autograph.status)
        ) {
          return null;
        }
        const { cleaned: approvedCleaned } = await verifyAutographEvidence(
          client,
          autograph,
          true,
        );
        const cleaned =
          autograph.status === 'awaiting_approval'
            ? await readCleaned(client, autographId, true)
            : approvedCleaned;
        return cleaned
          ? { assetId: cleaned.id, key: cleaned.storage_key }
          : null;
      });
    },

    async approveOwnedAutograph(userId, autographId, reviewedAssetId) {
      return withTransaction(pool, async (client) => {
        const autograph = await ownedAutograph(
          client,
          userId,
          autographId,
          true,
        );
        const approved = await readApproval(client, autographId);
        if (autograph.status === 'awaiting_moderation') {
          await verifyAutographEvidence(client, autograph, true);
          const cleaned = await readCleaned(client, autographId, true);
          if (
            !approved ||
            approved.user_id !== userId ||
            approved.cleaned_asset_id !== cleaned?.id
          ) {
            throw new AutographError('APPROVAL_STATE_INCONSISTENT');
          }
          if (reviewedAssetId !== cleaned.id) {
            throw new AutographError('REVIEWED_ASSET_MISMATCH');
          }
          return {
            id: autographId,
            status: 'awaiting_moderation',
            approvedAt: approved.approved_at,
          };
        }
        if (
          autograph.status === 'ready' ||
          autograph.status === 'moderation_rejected'
        ) {
          await verifyAutographEvidence(client, autograph, true);
          throw new AutographError('AUTOGRAPH_NOT_AWAITING_APPROVAL');
        }
        if (approved) throw new AutographError('APPROVAL_STATE_INCONSISTENT');
        if (autograph.status !== 'awaiting_approval') {
          throw new AutographError('AUTOGRAPH_NOT_AWAITING_APPROVAL');
        }
        const cleaned = await readCleaned(client, autographId, true);
        if (!cleaned) throw new AutographError('CLEANED_ASSET_NOT_AVAILABLE');
        if (reviewedAssetId !== cleaned.id) {
          throw new AutographError('REVIEWED_ASSET_MISMATCH');
        }
        const inserted = await client.query<{ approved_at: Date }>(
          `INSERT INTO autograph_user_approvals (autograph_id, user_id, cleaned_asset_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid) RETURNING approved_at`,
          [autographId, userId, cleaned.id],
        );
        const updated = await client.query(
          `UPDATE autographs SET status = 'awaiting_moderation'
           WHERE id = $1::uuid AND status = 'awaiting_approval'`,
          [autographId],
        );
        if (updated.rowCount !== 1 || !inserted.rows[0]) {
          throw new AutographError('APPROVAL_STATE_INCONSISTENT');
        }
        return {
          id: autographId,
          status: 'awaiting_moderation',
          approvedAt: inserted.rows[0].approved_at,
        };
      });
    },
  };
}
