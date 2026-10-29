import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { processingArtifactKey } from '@digital-autograph/autographs';
import { storageTransaction as transaction } from './storage-lease';
import { createAutographCleanup } from './autograph-cleanup';
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

export function createPgAutographProcessingRepository(pool: Pool) {
  return {
    async claim(leaseSeconds: number): Promise<ClaimedAutographJob | null> {
      return transaction(
        pool,
        async (client) => {
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
          if (!asset)
            throw new Error('Processing job has no uploaded original');
          const state = await client.query(
            `UPDATE autographs SET status = 'processing'
           WHERE id = $1::uuid AND status IN ('uploaded_unverified', 'processing')`,
            [job.autograph_id],
          );
          if (state.rowCount !== 1)
            throw new Error('Unexpected Autograph state during claim');
          const claimed = {
            id: job.id,
            autographId: job.autograph_id,
            originalAssetId: job.original_asset_id,
            originalKey: asset.storage_key,
            source: asset.source,
            expectedContentType: asset.expected_content_type,
            leaseToken,
          };
          await client.query(
            `INSERT INTO autograph_processing_artifacts(lease_token, job_id, storage_key, lease_expires_at, next_check_at)
           VALUES ($1::uuid, $2::uuid, $3, clock_timestamp() + $4 * interval '1 second', clock_timestamp() + $4 * interval '1 second')`,
            [leaseToken, job.id, processingArtifactKey(claimed), leaseSeconds],
          );
          return claimed;
        },
        async (claimed) =>
          !claimed ||
          (
            await pool.query(
              `SELECT 1 FROM autograph_processing_jobs j JOIN autograph_processing_artifacts p ON p.lease_token = j.lease_token
         WHERE j.id = $1::uuid AND j.status = 'processing' AND j.lease_token = $2::uuid
         AND j.claimed_at > clock_timestamp() - $3 * interval '1 second' AND p.retired_at IS NULL`,
              [claimed.id, claimed.leaseToken, leaseSeconds],
            )
          ).rowCount === 1,
      );
    },

    async succeed(
      job: ClaimedAutographJob,
      output: { key: string; sizeBytes: number; width: number; height: number },
      leaseSeconds: number,
    ): Promise<boolean> {
      return transaction(
        pool,
        async (client) => {
          const updated = await client.query(
            `UPDATE autograph_processing_jobs SET status = 'succeeded', lease_token = NULL,
           claimed_at = NULL, finished_at = now(), failure_code = NULL
           WHERE id = $1::uuid AND status = 'processing' AND lease_token = $2::uuid
             AND claimed_at > clock_timestamp() - $3::integer * interval '1 second'
           RETURNING id`,
            [job.id, job.leaseToken, leaseSeconds],
          );
          if (!updated.rowCount) return false;
          const artifact = await client.query(
            `UPDATE autograph_processing_artifacts SET adopted_at = clock_timestamp()
           WHERE lease_token = $1::uuid AND job_id = $2::uuid AND storage_key = $3
             AND adopted_at IS NULL AND retired_at IS NULL RETURNING lease_token`,
            [job.leaseToken, job.id, output.key],
          );
          if (!artifact.rowCount)
            throw new Error('Processing artifact is retired or mismatched');
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
        },
        async () =>
          (
            await pool.query(
              `SELECT 1 FROM autograph_processing_artifacts p
         JOIN autograph_assets aa ON aa.storage_key = p.storage_key
         JOIN autograph_processing_jobs j ON j.id = p.job_id
         WHERE p.lease_token = $1::uuid AND p.storage_key = $2 AND p.adopted_at IS NOT NULL
           AND aa.autograph_id = $3::uuid AND j.status = 'succeeded'`,
              [job.leaseToken, output.key, job.autographId],
            )
          ).rowCount === 1,
      );
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
             AND claimed_at > clock_timestamp() - $3::integer * interval '1 second'
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

    ...createAutographCleanup(pool),
  };
}

export type AutographProcessingRepository = ReturnType<
  typeof createPgAutographProcessingRepository
>;
