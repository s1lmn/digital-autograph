import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

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
export { createPgAutographRepository } from './autograph-repository';
export { createPgAutographModerationRepository } from './autograph-moderation-repository';
export {
  createPgAutographProcessingRepository,
  type ClaimedAutographJob,
  type AutographProcessingRepository,
} from './autograph-processing-repository';

export function createDatabase(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  pool.on('error', (error: Error) => {
    console.error('PostgreSQL idle connection error:', error.message);
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
