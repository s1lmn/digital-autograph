import { Pool } from 'pg';
import { workerLeaseLimits } from '@digital-autograph/config';

export type OperationalDatabaseState = {
  connections: number;
  connectionLimit: number;
  sameRoleQueriesOver30Seconds: number;
  processingReady: number;
  processingOldestReadySeconds: number;
  processingFailedLast15Minutes: number;
  processingInFlight: number;
  processingClaimsPastMaxLease: number;
  processingOldestClaimSeconds: number;
  paidNotFulfilled: number;
  reconciliationOverdue5Minutes: number;
  awaitingModeration: number;
  moderationOldestSeconds: number;
  originalUploadsReserved: number;
  originalUploadsExpired: number;
  originalUploadsOldestExpiredSeconds: number;
  retiredUploadKeys: number;
  retiredUploadKeysDue: number;
  retiredUploadOldestDueSeconds: number;
};

const query = `WITH processing AS (
  SELECT count(*) FILTER (WHERE status = 'queued' AND available_at <= now()) AS ready,
    coalesce(greatest(0, floor(extract(epoch FROM now() - min(available_at)
      FILTER (WHERE status = 'queued' AND available_at <= now())))), 0) AS oldest_ready_seconds,
    count(*) FILTER (WHERE status = 'failed' AND finished_at >= now() - interval '15 minutes') AS failed_recently,
    count(*) FILTER (WHERE status = 'processing') AS in_flight,
    count(*) FILTER (WHERE status = 'processing'
      AND claimed_at < now() - $1::integer * interval '1 second') AS past_max_lease,
    coalesce(greatest(0, floor(extract(epoch FROM now() - min(claimed_at)
      FILTER (WHERE status = 'processing')))), 0) AS oldest_claim_seconds
  FROM autograph_processing_jobs
), original_uploads AS (
  SELECT count(*) AS reserved,
    count(*) FILTER (WHERE upload_expires_at <= now()) AS expired,
    coalesce(greatest(0, floor(extract(epoch FROM now() - min(upload_expires_at)))), 0) AS oldest_expired_seconds
  FROM autograph_assets WHERE role = 'original' AND status = 'reserved'
), retired_uploads AS (
  SELECT count(*) AS total,
    count(*) FILTER (WHERE next_check_at <= now()) AS due,
    coalesce(greatest(0, floor(extract(epoch FROM now() - min(next_check_at)))), 0) AS oldest_due_seconds
  FROM original_upload_tombstones
) SELECT
  current_setting('transaction_read_only') AS "readOnly",
  (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS connections,
  current_setting('max_connections') AS "connectionLimit",
  (SELECT count(*) FROM pg_stat_activity
    WHERE datname = current_database() AND usename = current_user
      AND pid <> pg_backend_pid() AND state = 'active'
      AND query_start < now() - interval '30 seconds') AS "sameRoleQueriesOver30Seconds",
  processing.ready AS "processingReady",
  processing.oldest_ready_seconds AS "processingOldestReadySeconds",
  processing.failed_recently AS "processingFailedLast15Minutes",
  processing.in_flight AS "processingInFlight",
  processing.past_max_lease AS "processingClaimsPastMaxLease",
  processing.oldest_claim_seconds AS "processingOldestClaimSeconds",
  (SELECT count(*) FROM payment_orders o LEFT JOIN payments p ON p.order_id = o.id
    WHERE o.status = 'paid_but_not_fulfilled' OR
      (p.status IN ('succeeded', 'paid_but_not_fulfilled', 'fulfilled') AND o.status <> 'fulfilled')) AS "paidNotFulfilled",
  (SELECT count(*) FROM payments WHERE status IN ('created', 'provider_pending', 'unknown')
    AND next_check_at < now() - interval '5 minutes') AS "reconciliationOverdue5Minutes",
  (SELECT count(*) FROM autographs WHERE status = 'awaiting_moderation') AS "awaitingModeration",
  (SELECT coalesce(greatest(0, floor(extract(epoch FROM now() - min(updated_at)))), 0)
    FROM autographs WHERE status = 'awaiting_moderation') AS "moderationOldestSeconds",
  original_uploads.reserved AS "originalUploadsReserved",
  original_uploads.expired AS "originalUploadsExpired",
  original_uploads.oldest_expired_seconds AS "originalUploadsOldestExpiredSeconds",
  retired_uploads.total AS "retiredUploadKeys",
  retired_uploads.due AS "retiredUploadKeysDue",
  retired_uploads.oldest_due_seconds AS "retiredUploadOldestDueSeconds"
  FROM processing CROSS JOIN original_uploads CROSS JOIN retired_uploads`;

const fields: readonly (keyof OperationalDatabaseState)[] = [
  'connections',
  'connectionLimit',
  'sameRoleQueriesOver30Seconds',
  'processingReady',
  'processingOldestReadySeconds',
  'processingFailedLast15Minutes',
  'processingInFlight',
  'processingClaimsPastMaxLease',
  'processingOldestClaimSeconds',
  'paidNotFulfilled',
  'reconciliationOverdue5Minutes',
  'awaitingModeration',
  'moderationOldestSeconds',
  'originalUploadsReserved',
  'originalUploadsExpired',
  'originalUploadsOldestExpiredSeconds',
  'retiredUploadKeys',
  'retiredUploadKeysDue',
  'retiredUploadOldestDueSeconds',
];

export function decodeOperationalState(
  row: Record<string, unknown>,
): OperationalDatabaseState {
  const output = {} as OperationalDatabaseState;
  for (const field of fields) {
    const value = row[field];
    if (
      typeof value !== 'string' ||
      !/^\d+$/.test(value) ||
      !Number.isSafeInteger(Number(value))
    ) {
      throw new Error('Invalid operational aggregate');
    }
    output[field] = Number(value);
  }
  if (output.connectionLimit < 1) throw new Error('Invalid connection limit');
  return output;
}

// Separate one-connection operator pool; no runtime pool/listener changes.
export function createOperationalReader(databaseUrl: string) {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 3000,
    query_timeout: 5000,
    statement_timeout: 3000,
    options: '-c default_transaction_read_only=on',
    application_name: 'autograph-operations',
  });
  // Never let pg's idle error event print raw connection details.
  pool.on('error', () => {});
  return {
    async read(): Promise<OperationalDatabaseState> {
      const result = await pool.query(query, [workerLeaseLimits.maxSeconds]);
      if (result.rows[0]?.readOnly !== 'on')
        throw new Error('Read-only observation required');
      return decodeOperationalState(result.rows[0] as Record<string, unknown>);
    },
    async close() {
      await pool.end();
    },
  };
}
