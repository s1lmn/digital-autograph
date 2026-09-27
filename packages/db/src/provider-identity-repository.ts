import {
  IdentityNotAllowedError,
  type ProviderIdentityRepository,
} from '@digital-autograph/auth';
import type { Pool, PoolClient } from 'pg';

type LinkedUser = { user_id: string; status: string };

async function existingUser(
  client: PoolClient,
  provider: string,
  providerUserId: string,
): Promise<string | null> {
  const result = await client.query<LinkedUser>(
    `SELECT si.user_id, u.status
     FROM social_identities si JOIN users u ON u.id = si.user_id
     WHERE si.provider = $1 AND si.provider_user_id = $2
     FOR UPDATE OF u`,
    [provider, providerUserId],
  );
  const user = result.rows[0];
  if (!user) return null;
  if (user.status !== 'active') throw new IdentityNotAllowedError();
  return user.user_id;
}

export function createPgProviderIdentityRepository(
  pool: Pool,
): ProviderIdentityRepository {
  return {
    async resolveOrCreateUser(provider, providerUserId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Equal identities serialize; the unique index remains the final guard.
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
          [`${provider.length}:${provider}${providerUserId}`],
        );
        const linked = await existingUser(client, provider, providerUserId);
        if (linked) {
          await client.query('COMMIT');
          return linked;
        }
        const created = await client.query<{ id: string }>(
          "INSERT INTO users (status) VALUES ('active') RETURNING id",
        );
        const userId = created.rows[0]?.id;
        if (!userId) throw new Error('User creation returned no row');
        await client.query(
          `INSERT INTO social_identities (user_id, provider, provider_user_id)
           VALUES ($1::uuid, $2, $3)`,
          [userId, provider, providerUserId],
        );
        await client.query('COMMIT');
        return userId;
      } catch (error) {
        await client.query('ROLLBACK');
        // An external writer may have won without taking the advisory lock.
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === '23505' &&
          'constraint' in error &&
          error.constraint === 'social_identities_provider_user_uidx'
        ) {
          await client.query('BEGIN');
          try {
            const linked = await existingUser(client, provider, providerUserId);
            await client.query('COMMIT');
            if (linked) return linked;
          } catch (readError) {
            await client.query('ROLLBACK');
            throw readError;
          }
        }
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
