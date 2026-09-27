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
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

export function createPgAutographRepository(pool: Pool): AutographRepository {
  return {
    async create(userId, source) {
      const result = await pool.query<AutographRow>(
        `INSERT INTO autographs (user_id, source) VALUES ($1::uuid, $2::autograph_source)
         RETURNING id, user_id, source, status, created_at, updated_at`,
        [userId, source],
      );
      const row = result.rows[0];
      if (!row) throw new Error('Autograph insertion returned no row');
      return view(pool, row);
    },

    async findOwned(userId, autographId) {
      return view(pool, await ownedAutograph(pool, userId, autographId));
    },

    async reserveOriginal(userId, autographId, input) {
      return withTransaction(pool, async (client) => {
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
          const refreshed = await client.query<AssetRow>(
            `UPDATE autograph_assets SET upload_expires_at = $2::timestamptz
             WHERE id = $1::uuid
             RETURNING id, autograph_id, storage_key, status, expected_content_type,
                       expected_size_bytes, verified_size_bytes, upload_expires_at, uploaded_at`,
            [existing.id, input.expiresAt],
          );
          const row = refreshed.rows[0];
          if (!row) throw new Error('Asset refresh returned no row');
          return toReserved(row);
        }
        if (autograph.status !== 'draft') {
          throw new AutographError('INVALID_AUTOGRAPH_STATE');
        }
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

    async completeOriginal(userId, autographId, assetId, actualSizeBytes) {
      return withTransaction(pool, async (client) => {
        const autograph = await ownedAutograph(
          client,
          userId,
          autographId,
          true,
        );
        const asset = await originalAsset(client, autographId);
        if (!asset || asset.id !== assetId)
          throw new AutographError('INVALID_AUTOGRAPH_STATE');
        if (
          autograph.status === 'uploaded_unverified' &&
          asset.status === 'uploaded'
        ) {
          return view(client, autograph);
        }
        if (
          autograph.status !== 'upload_pending' ||
          asset.status !== 'reserved'
        ) {
          throw new AutographError('INVALID_AUTOGRAPH_STATE');
        }
        await client.query(
          `UPDATE autograph_assets SET status = 'uploaded',
             verified_size_bytes = $2::integer, uploaded_at = now()
           WHERE id = $1::uuid`,
          [assetId, actualSizeBytes],
        );
        const updated = await client.query<AutographRow>(
          `UPDATE autographs SET status = 'uploaded_unverified' WHERE id = $1::uuid
           RETURNING id, user_id, source, status, created_at, updated_at`,
          [autographId],
        );
        const row = updated.rows[0];
        if (!row) throw new Error('Autograph update returned no row');
        return view(client, row);
      });
    },
  };
}
