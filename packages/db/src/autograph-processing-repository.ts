import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { AutographSource } from '@digital-autograph/domain';

export type ClaimedAutographJob = {
  id: string;
  autographId: string;
  originalAssetId: string;
  originalKey: string;
  source: AutographSource;
  expectedContentType: string;
  leaseToken: string;
};

type JobRow = {
  id: string;
  autograph_id: string;
  original_asset_id: string;
  attempts: number;
};

async function transaction<T>(
  pool: Pool,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function createPgAutographProcessingRepository(pool: Pool) {
  return {
    async claim(leaseSeconds: number): Promise<ClaimedAutographJob | null> {
      return transaction(pool, async (client) => {
        const selected = await client.query<JobRow>(
          `SELECT id, autograph_id, original_asset_id, attempts
           FROM autograph_processing_jobs
           WHERE (status = 'queued' AND available_at <= now())
              OR (status = 'processing' AND claimed_at < now() - $1::integer * interval '1 second')
           ORDER BY available_at, created_at
           LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [leaseSeconds],
        );
        const job = selected.rows[0];
        if (!job) return null;
        if (job.attempts >= 3) {
          await client.query(
            `UPDATE autograph_processing_jobs SET status = 'failed', failure_code = 'PROCESSING_FAILURE',
             lease_token = NULL, claimed_at = NULL, finished_at = now() WHERE id = $1::uuid`,
            [job.id],
          );
          await client.query(
            `UPDATE autographs SET status = 'processing_failed' WHERE id = $1::uuid AND status = 'processing'`,
            [job.autograph_id],
          );
          return null;
        }
        const leaseToken = randomUUID();
        await client.query(
          `UPDATE autograph_processing_jobs SET status = 'processing', attempts = attempts + 1,
           claimed_at = now(), lease_token = $2::uuid, failure_code = NULL WHERE id = $1::uuid`,
          [job.id, leaseToken],
        );
        const found = await client.query<{
          storage_key: string;
          source: AutographSource;
          expected_content_type: string;
        }>(
          `SELECT aa.storage_key, aa.expected_content_type, a.source FROM autographs a
           JOIN autograph_assets aa ON aa.id = $2::uuid AND aa.autograph_id = a.id
           WHERE a.id = $1::uuid AND aa.role = 'original' AND aa.status = 'uploaded'
           FOR UPDATE OF a`,
          [job.autograph_id, job.original_asset_id],
        );
        const asset = found.rows[0];
        if (!asset) throw new Error('Processing job has no uploaded original');
        const state = await client.query(
          `UPDATE autographs SET status = 'processing'
           WHERE id = $1::uuid AND status IN ('uploaded_unverified', 'processing')`,
          [job.autograph_id],
        );
        if (state.rowCount !== 1)
          throw new Error('Unexpected Autograph state during claim');
        return {
          id: job.id,
          autographId: job.autograph_id,
          originalAssetId: job.original_asset_id,
          originalKey: asset.storage_key,
          source: asset.source,
          expectedContentType: asset.expected_content_type,
          leaseToken,
        };
      });
    },

    async succeed(
      job: ClaimedAutographJob,
      output: { key: string; sizeBytes: number; width: number; height: number },
      leaseSeconds: number,
    ): Promise<boolean> {
      return transaction(pool, async (client) => {
        const updated = await client.query(
          `UPDATE autograph_processing_jobs SET status = 'succeeded', lease_token = NULL,
           claimed_at = NULL, finished_at = now(), failure_code = NULL
           WHERE id = $1::uuid AND status = 'processing' AND lease_token = $2::uuid
             AND claimed_at > now() - $3::integer * interval '1 second'
           RETURNING id`,
          [job.id, job.leaseToken, leaseSeconds],
        );
        if (!updated.rowCount) return false;
        await client.query(
          `INSERT INTO autograph_assets
             (autograph_id, role, status, storage_key, actual_content_type, verified_size_bytes, width, height, uploaded_at)
           VALUES ($1::uuid, 'cleaned', 'uploaded', $2, 'image/png', $3, $4, $5, now())
           ON CONFLICT (autograph_id) WHERE role <> 'original' DO NOTHING`,
          [
            job.autographId,
            output.key,
            output.sizeBytes,
            output.width,
            output.height,
          ],
        );
        const asset = await client.query<{ storage_key: string }>(
          `SELECT storage_key FROM autograph_assets WHERE autograph_id = $1::uuid AND role = 'cleaned'`,
          [job.autographId],
        );
        if (asset.rows[0]?.storage_key !== output.key)
          throw new Error('Unexpected cleaned asset identity');
        const state = await client.query(
          `UPDATE autographs SET status = 'awaiting_approval'
           WHERE id = $1::uuid AND status = 'processing'`,
          [job.autographId],
        );
        if (state.rowCount !== 1)
          throw new Error('Unexpected Autograph state during success');
        return true;
      });
    },

    async fail(
      job: ClaimedAutographJob,
      code: string,
      permanent: boolean,
      leaseSeconds: number,
    ): Promise<boolean> {
      return transaction(pool, async (client) => {
        const selected = await client.query<JobRow>(
          `SELECT id, autograph_id, original_asset_id, attempts FROM autograph_processing_jobs
           WHERE id = $1::uuid AND status = 'processing' AND lease_token = $2::uuid
             AND claimed_at > now() - $3::integer * interval '1 second'
           FOR UPDATE`,
          [job.id, job.leaseToken, leaseSeconds],
        );
        const row = selected.rows[0];
        if (!row) return false;
        const terminal = permanent || row.attempts >= 3;
        await client.query(
          `UPDATE autograph_processing_jobs SET status = $2::autograph_processing_job_status,
           failure_code = $3, lease_token = NULL, claimed_at = NULL,
           finished_at = CASE WHEN $4::boolean THEN now() ELSE NULL END,
           available_at = CASE WHEN $4::boolean THEN available_at ELSE now() + ($5::integer * interval '1 second') END
           WHERE id = $1::uuid`,
          [
            job.id,
            terminal ? 'failed' : 'queued',
            code,
            terminal,
            5 * row.attempts,
          ],
        );
        if (terminal) {
          await client.query(
            `UPDATE autographs SET status = 'processing_failed'
             WHERE id = $1::uuid AND status = 'processing'`,
            [job.autographId],
          );
        }
        return true;
      });
    },

    async cleanupPartial(
      job: ClaimedAutographJob,
      leaseSeconds: number,
      deleteObject: () => Promise<void>,
    ): Promise<boolean> {
      return transaction(pool, async (client) => {
        const owned = await client.query(
          `SELECT id FROM autograph_processing_jobs
           WHERE id = $1::uuid AND status = 'processing' AND lease_token = $2::uuid
             AND claimed_at > now() - $3::integer * interval '1 second'
           FOR UPDATE`,
          [job.id, job.leaseToken, leaseSeconds],
        );
        if (!owned.rowCount) return false;
        await deleteObject();
        return true;
      });
    },

    async cleanupAbandoned(
      graceSeconds: number,
      deleteObject: (key: string) => Promise<void>,
    ): Promise<boolean> {
      return transaction(pool, async (client) => {
        const selected = await client.query<{
          autograph_id: string;
          asset_id: string;
          storage_key: string;
        }>(
          `SELECT a.id AS autograph_id, aa.id AS asset_id, aa.storage_key
           FROM autographs a JOIN autograph_assets aa ON aa.autograph_id = a.id
           WHERE a.status = 'upload_pending' AND aa.role = 'original' AND aa.status = 'reserved'
             AND aa.upload_expires_at < now() - $1::integer * interval '1 second'
           ORDER BY aa.upload_expires_at LIMIT 1 FOR UPDATE OF a SKIP LOCKED`,
          [graceSeconds],
        );
        const row = selected.rows[0];
        if (!row) return false;
        await deleteObject(row.storage_key);
        await client.query(
          `DELETE FROM autograph_assets WHERE id = $1::uuid AND status = 'reserved'`,
          [row.asset_id],
        );
        await client.query(
          `UPDATE autographs SET status = 'draft' WHERE id = $1::uuid AND status = 'upload_pending'`,
          [row.autograph_id],
        );
        return true;
      });
    },
  };
}

export type AutographProcessingRepository = ReturnType<
  typeof createPgAutographProcessingRepository
>;
