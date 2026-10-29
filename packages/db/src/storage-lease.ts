import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Pool, PoolClient } from 'pg';
import { AutographError } from '@digital-autograph/autographs';
import { autographResourceLimits } from './autograph-resource-limits';

export const storageLeaseSeconds = 60;
export const storageWorkTimeoutMs = 40_000;

export class StorageCommitUnknownError extends Error {
  constructor() {
    super('Storage transaction outcome requires reconciliation');
    this.name = 'StorageCommitUnknownError';
  }
}

// Only a verified durable receipt may resolve a lost COMMIT response. Never
// replay the mutation, infer rollback, or run external I/O on an unknown claim.
export async function storageTransaction<T>(
  pool: Pool,
  action: (client: PoolClient) => Promise<T>,
  recover?: (result: T) => Promise<boolean>,
): Promise<T> {
  const client = await pool.connect();
  let committing = false;
  let unknown = false;
  let result!: T;
  let destroy = false;
  try {
    await client.query('BEGIN');
    result = await action(client);
    committing = true;
    await client.query('COMMIT');
  } catch (error) {
    destroy = true;
    if (committing) unknown = true;
    else {
      try {
        await client.query('ROLLBACK');
        // Expected refusals do not poison a connection. In particular, a
        // same-key retry must not establish a new connection every25ms.
        if (error instanceof AutographError) destroy = false;
      } catch {
        // Discard the client; preserve the original bounded failure.
      }
      if (error instanceof Error && 'code' in error && error.code === '55P03')
        throw new AutographError('UPLOAD_BUSY');
      throw error;
    }
  } finally {
    client.release(destroy);
  }
  if (unknown && (!recover || !(await recover(result))))
    throw new StorageCommitUnknownError();
  return result;
}

export type StorageLease = { token: string; key: string };
class ResourceBusy extends AutographError {
  constructor() {
    super('UPLOAD_BUSY');
  }
}

// Wait only for this immutable resource, outside a transaction/connection. This
// preserves short concurrent PUT/complete retries without waiting on full pools.
export async function waitForStorageResource<T>(action: () => Promise<T>) {
  const deadline = performance.now() + 2000;
  for (;;) {
    try {
      return await action();
    } catch (error) {
      if (!(error instanceof ResourceBusy) || performance.now() >= deadline)
        throw error;
      await delay(25);
    }
  }
}

export async function acquireStorageLease(
  client: PoolClient,
  key: string,
  kind: 'upload' | 'complete' | 'cleanup',
): Promise<StorageLease> {
  // Serializes only small admission statements, never external work.
  await client.query('SELECT pg_advisory_xact_lock(764213, 0)');
  await client.query(
    'DELETE FROM autograph_storage_leases WHERE expires_at <= clock_timestamp()',
  );
  const busy = await client.query(
    'SELECT 1 FROM autograph_storage_leases WHERE storage_key = $1',
    [key],
  );
  if (busy.rowCount) throw new ResourceBusy();
  const first = kind === 'cleanup' ? autographResourceLimits.parallelIo + 1 : 1;
  const last = kind === 'cleanup' ? first : autographResourceLimits.parallelIo;
  const slot = await client.query<{ slot: number }>(
    `SELECT n AS slot FROM generate_series($1::integer, $2::integer) n
     WHERE NOT EXISTS (SELECT 1 FROM autograph_storage_leases l WHERE l.slot = n)
     ORDER BY n LIMIT 1`,
    [first, last],
  );
  if (!slot.rows[0]) throw new AutographError('UPLOAD_BUSY');
  const token = randomUUID();
  await client.query(
    `INSERT INTO autograph_storage_leases(slot, operation_id, storage_key, kind, expires_at)
     VALUES ($1, $2::uuid, $3, $4, clock_timestamp() + $5 * interval '1 second')`,
    [slot.rows[0].slot, token, key, kind, storageLeaseSeconds],
  );
  return { token, key };
}

export async function ownsStorageLease(pool: Pool, lease: StorageLease) {
  const result = await pool.query(
    `SELECT 1 FROM autograph_storage_leases WHERE operation_id = $1::uuid
       AND storage_key = $2 AND expires_at > clock_timestamp()`,
    [lease.token, lease.key],
  );
  return result.rowCount === 1;
}

export async function fenceStorageLease(
  client: PoolClient,
  lease: StorageLease,
) {
  const result = await client.query(
    `SELECT 1 FROM autograph_storage_leases WHERE operation_id = $1::uuid
       AND storage_key = $2 AND expires_at > clock_timestamp() FOR UPDATE`,
    [lease.token, lease.key],
  );
  if (result.rowCount !== 1) throw new AutographError('UPLOAD_BUSY');
}

export async function releaseStorageLease(
  db: Pool | PoolClient,
  lease: StorageLease,
) {
  await db.query(
    'DELETE FROM autograph_storage_leases WHERE operation_id = $1::uuid AND storage_key = $2',
    [lease.token, lease.key],
  );
}

export async function abandonStorageLease(pool: Pool, lease: StorageLease) {
  try {
    await releaseStorageLease(pool, lease);
  } catch {
    // The durable lease expires. Never log keys, query/driver errors or payloads.
    console.warn('Private storage lease release deferred');
  }
}

export async function boundedStorageWork<T>(
  action: () => Promise<T>,
  timeoutMs = storageWorkTimeoutMs,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(action),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new AutographError('UPLOAD_TIMEOUT')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
