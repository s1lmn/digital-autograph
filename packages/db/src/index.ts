import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { safeErrorDetails } from '@digital-autograph/observability';

export { eq, sql } from 'drizzle-orm';
export { createPgSessionRepository } from './session-repository';
export { createPgOAuthAttemptRepository } from './oauth-attempt-repository';
export { createPgOAuthAttemptCleanup } from './oauth-attempt-cleanup';
export { createPgProviderIdentityRepository } from './provider-identity-repository';
export { createPgWallRepository } from './wall-repository';
export { createPgPlacementHistoryRepository } from './placement-history-repository';
export { createPgFreeClaimRepository } from './free-claim-repository';
export { createPgPublicPlacementMediaRepository } from './public-placement-media-repository';
export { createPgPricingRepository } from './pricing-repository';
export { createPgTakeoverReservationRepository } from './takeover-reservation-repository';
export {
  autographResourceLimits,
  createPgAutographRepository,
} from './autograph-repository';
export { createPgAutographModerationRepository } from './autograph-moderation-repository';
export {
  createPgAutographProcessingRepository,
  type ClaimedAutographJob,
  type AutographProcessingRepository,
} from './autograph-processing-repository';

export function createDatabase(databaseUrl: string) {
  // pg parses DSN parameters after explicit options. Fix runtime startup/timeout
  // options so a stale URL or PGOPTIONS cannot restore infinite waits.
  const url = new URL(databaseUrl);
  for (const field of [
    'statement_timeout',
    'lock_timeout',
    'query_timeout',
    'idle_in_transaction_session_timeout',
    'connectionTimeoutMillis',
    'connect_timeout',
    'options',
  ])
    url.searchParams.delete(field);
  const pool = new Pool({
    connectionString: url.href,
    connectionTimeoutMillis: 3000,
    statement_timeout: 10000,
    lock_timeout: 5000,
    idle_in_transaction_session_timeout: 15000,
    query_timeout: 12000,
    options:
      '-c statement_timeout=10000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=15000',
  });
  pool.on('error', (error: unknown) => {
    console.error(
      JSON.stringify({
        level: 50,
        time: new Date().toISOString(),
        event: 'POSTGRES_IDLE_CONNECTION_FAILED',
        err: safeErrorDetails(error),
        msg: 'PostgreSQL idle connection failed',
      }),
    );
  });
  const db = drizzle({ client: pool });

  return {
    db,
    pool,
    async checkConnection(): Promise<void> {
      await pool.query('SELECT 1');
    },
    async close(): Promise<void> {
      await pool.end();
    },
    transaction: db.transaction.bind(db),
  };
}

export type Database = ReturnType<typeof createDatabase>;
export { createPgPaymentRepository } from './payment-repository';
export { createPgNotificationRepository } from './notification-repository';
export { createPgShareRepository } from './share-repository';
export {
  createOperationalReader,
  type OperationalDatabaseState,
} from './operational-snapshot';

export { createPgLegalRepository } from './legal-repository';

export { createPgAgeDeclarationRepository } from './age-declaration-repository';
