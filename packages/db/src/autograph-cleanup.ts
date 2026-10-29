import type { Pool } from 'pg';
import {
  AutographError,
  processingArtifactKey,
} from '@digital-autograph/autographs';
import type { ClaimedAutographJob } from './autograph-processing-repository';
import {
  storageTransaction,
  acquireStorageLease,
  ownsStorageLease,
  fenceStorageLease,
  releaseStorageLease,
  abandonStorageLease,
  boundedStorageWork,
  type StorageLease,
} from './storage-lease';

type CleanupClaim = {
  lease: StorageLease;
  original?: { autograph_id: string; asset_id: string; storage_key: string };
};

export function createAutographCleanup(pool: Pool) {
  return {
    async cleanupPartial(
      job: ClaimedAutographJob,
      leaseSeconds: number,
      deleteObject: () => Promise<void>,
    ): Promise<boolean> {
      const claim = await storageTransaction(
        pool,
        async (client) => {
          const owned = await client.query(
            `SELECT id FROM autograph_processing_jobs WHERE id = $1::uuid AND status = 'processing'
           AND lease_token = $2::uuid AND claimed_at > clock_timestamp() - $3 * interval '1 second' FOR UPDATE`,
            [job.id, job.leaseToken, leaseSeconds],
          );
          if (!owned.rowCount) return null;
          const key = processingArtifactKey(job);
          const artifact = await client.query(
            `SELECT 1 FROM autograph_processing_artifacts WHERE lease_token = $1::uuid
           AND job_id = $2::uuid AND storage_key = $3 AND adopted_at IS NULL FOR UPDATE`,
            [job.leaseToken, job.id, key],
          );
          if (!artifact.rowCount) return null;
          const lease = await acquireStorageLease(client, key, 'cleanup');
          // Irreversible retirement before DELETE prevents even same-token adoption.
          await client.query(
            `UPDATE autograph_processing_artifacts SET retired_at = coalesce(retired_at, clock_timestamp()),
           next_check_at = clock_timestamp() + interval '1 hour' WHERE lease_token = $1::uuid`,
            [job.leaseToken],
          );
          return lease;
        },
        (lease) =>
          lease ? ownsStorageLease(pool, lease) : Promise.resolve(true),
      );
      if (!claim) return false;
      try {
        await boundedStorageWork(deleteObject, 15_000);
        return true;
      } finally {
        await abandonStorageLease(pool, claim);
      }
    },

    async cleanupAbandoned(
      graceSeconds: number,
      deleteObject: (key: string) => Promise<void>,
    ): Promise<boolean> {
      const claim = await storageTransaction<CleanupClaim | null>(
        pool,
        async (client) => {
          const schedule = await client.query<{ next_source: number }>(
            'SELECT next_source FROM autograph_cleanup_schedule WHERE id = 1 FOR UPDATE',
          );
          const start = schedule.rows[0]?.next_source;
          if (start === undefined)
            throw new Error('Cleanup scheduling state unavailable');
          const advance = async <T>(source: number, result: T): Promise<T> => {
            await client.query(
              'UPDATE autograph_cleanup_schedule SET next_source = $1 WHERE id = 1',
              [(source + 1) % 3],
            );
            return result;
          };
          // Empty queues are skipped; each eligible source gets a turn within
          // three committed claims, even when original deletion keeps failing.
          // The cursor lock and all key/row locks are released before storage I/O.
          for (let offset = 0; offset < 3; offset++) {
            const source = (start + offset) % 3;
            if (source === 0) {
              const selected = await client.query<{
                autograph_id: string;
                asset_id: string;
                storage_key: string;
              }>(
                `SELECT a.id AS autograph_id, aa.id AS asset_id, aa.storage_key
           FROM autographs a JOIN autograph_assets aa ON aa.autograph_id = a.id
           WHERE a.status = 'upload_pending' AND aa.role = 'original' AND aa.status = 'reserved'
             AND aa.upload_expires_at < clock_timestamp() - $1 * interval '1 second'
             AND NOT EXISTS (SELECT 1 FROM autograph_storage_leases l WHERE l.storage_key = aa.storage_key AND l.expires_at > clock_timestamp())
           ORDER BY aa.upload_expires_at LIMIT 1 FOR UPDATE OF a SKIP LOCKED`,
                [graceSeconds],
              );
              const row = selected.rows[0];
              if (row) {
                const lease = await acquireStorageLease(
                  client,
                  row.storage_key,
                  'cleanup',
                );
                await client.query(
                  'UPDATE autograph_assets SET retired_at = coalesce(retired_at, clock_timestamp()) WHERE id = $1::uuid',
                  [row.asset_id],
                );
                return advance(source, { lease, original: row });
              }

              continue;
            }
            if (source === 1) {
              const retired = await client.query<{ storage_key: string }>(
                `SELECT t.storage_key FROM original_upload_tombstones t WHERE t.next_check_at <= clock_timestamp()
           AND NOT EXISTS (SELECT 1 FROM autograph_assets aa WHERE aa.storage_key = t.storage_key)
           AND NOT EXISTS (SELECT 1 FROM autograph_storage_leases l WHERE l.storage_key = t.storage_key AND l.expires_at > clock_timestamp())
           ORDER BY t.next_check_at LIMIT 1 FOR UPDATE OF t SKIP LOCKED`,
              );
              if (retired.rows[0]) {
                const key = retired.rows[0].storage_key;
                const lease = await acquireStorageLease(client, key, 'cleanup');
                await client.query(
                  "UPDATE original_upload_tombstones SET next_check_at = clock_timestamp() + interval '1 hour' WHERE storage_key = $1",
                  [key],
                );
                return advance(source, { lease });
              }

              continue;
            }
            const artifact = await client.query<{
              lease_token: string;
              storage_key: string;
            }>(
              `SELECT p.lease_token, p.storage_key FROM autograph_processing_artifacts p
           WHERE p.adopted_at IS NULL AND p.lease_expires_at <= clock_timestamp() AND p.next_check_at <= clock_timestamp()
           AND NOT EXISTS (SELECT 1 FROM autograph_assets aa WHERE aa.storage_key = p.storage_key)
           AND NOT EXISTS (SELECT 1 FROM autograph_storage_leases l WHERE l.storage_key = p.storage_key AND l.expires_at > clock_timestamp())
           ORDER BY p.next_check_at LIMIT 1 FOR UPDATE OF p SKIP LOCKED`,
            );
            if (!artifact.rows[0]) continue;
            const lease = await acquireStorageLease(
              client,
              artifact.rows[0].storage_key,
              'cleanup',
            );
            await client.query(
              `UPDATE autograph_processing_artifacts SET retired_at = coalesce(retired_at, clock_timestamp()),
           next_check_at = clock_timestamp() + interval '1 hour' WHERE lease_token = $1::uuid`,
              [artifact.rows[0].lease_token],
            );
            return advance(source, { lease });
          }
          return null;
        },
        (result) =>
          result ? ownsStorageLease(pool, result.lease) : Promise.resolve(true),
      ).catch((error: unknown) => {
        if (error instanceof AutographError && error.code === 'UPLOAD_BUSY')
          return null;
        throw error;
      });
      if (!claim) return false;
      try {
        try {
          await boundedStorageWork(() => deleteObject(claim.lease.key), 15_000);
        } catch (error) {
          if (claim.original) throw error; // Still charged and permanently retired.
          console.warn('Retired private upload cleanup failed');
          return true;
        }
        if (claim.original) {
          const original = claim.original;
          await storageTransaction(
            pool,
            async (client) => {
              await client.query(
                'SELECT id FROM autographs WHERE id = $1::uuid FOR UPDATE',
                [original.autograph_id],
              );
              await fenceStorageLease(client, claim.lease);
              const deleted = await client.query(
                `DELETE FROM autograph_assets WHERE id = $1::uuid AND storage_key = $2
               AND status = 'reserved' AND retired_at IS NOT NULL`,
                [original.asset_id, claim.lease.key],
              );
              if (deleted.rowCount !== 1)
                throw new AutographError('INVALID_AUTOGRAPH_STATE');
              await client.query(
                `INSERT INTO original_upload_tombstones(storage_key, next_check_at)
               VALUES ($1, clock_timestamp() + interval '1 hour') ON CONFLICT DO NOTHING`,
                [claim.lease.key],
              );
              await client.query(
                "UPDATE autographs SET status = 'draft' WHERE id = $1::uuid AND status = 'upload_pending'",
                [original.autograph_id],
              );
              await releaseStorageLease(client, claim.lease);
              return true;
            },
            async () =>
              (
                await pool.query(
                  `SELECT 1 FROM original_upload_tombstones WHERE storage_key = $1
             AND NOT EXISTS (SELECT 1 FROM autograph_assets WHERE id = $2::uuid)`,
                  [claim.lease.key, original.asset_id],
                )
              ).rowCount === 1,
          );
        }
        return true;
      } finally {
        await abandonStorageLease(pool, claim.lease);
      }
    },
  };
}
