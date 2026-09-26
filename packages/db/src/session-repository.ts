import type { SessionRepository } from '@digital-autograph/auth';
import type { Pool, PoolClient } from 'pg';

type SavedRow = { id: string; user_id: string; expires_at: Date };
type ActiveRow = {
  id: string;
  user_id: string;
  expires_at: Date;
};

async function inTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function createPgSessionRepository(pool: Pool): SessionRepository {
  return {
    async createForActiveUser(userId, secretHash, ttlSeconds) {
      return inTransaction(pool, async (client) => {
        const user = await client.query(
          "SELECT id FROM users WHERE id = $1::uuid AND status = 'active' FOR UPDATE",
          [userId],
        );
        if (!user.rows[0]) return null;
        const result = await client.query<SavedRow>(
          `INSERT INTO sessions (user_id, secret_hash, created_at, expires_at)
           VALUES ($1, $2, statement_timestamp(), statement_timestamp() + ($3::integer * interval '1 second'))
           RETURNING id, user_id, expires_at`,
          [userId, secretHash, ttlSeconds],
        );
        const row = result.rows[0];
        if (!row) throw new Error('Session creation insert returned no row');
        return { id: row.id, userId: row.user_id, expiresAt: row.expires_at };
      });
    },

    async findActiveByHash(secretHash) {
      const result = await pool.query<ActiveRow>(
        `SELECT s.id, s.user_id, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.secret_hash = $1 AND s.revoked_at IS NULL
           AND s.expires_at > statement_timestamp() AND u.status = 'active'`,
        [secretHash],
      );
      const row = result.rows[0];
      return row
        ? {
            sessionId: row.id,
            user: { id: row.user_id, status: 'active' },
            expiresAt: row.expires_at,
          }
        : null;
    },

    async rotateActive(oldSecretHash, newSecretHash, ttlSeconds) {
      return inTransaction(pool, async (client) => {
        const existing = await client.query<{ user_id: string }>(
          'SELECT user_id FROM sessions WHERE secret_hash = $1',
          [oldSecretHash],
        );
        const userId = existing.rows[0]?.user_id;
        if (!userId) return null;
        const user = await client.query(
          "SELECT id FROM users WHERE id = $1::uuid AND status = 'active' FOR UPDATE",
          [userId],
        );
        if (!user.rows[0]) return null;
        const revoked = await client.query<{ user_id: string }>(
          `UPDATE sessions s SET revoked_at = statement_timestamp()
           WHERE s.secret_hash = $1 AND s.revoked_at IS NULL
             AND s.expires_at > statement_timestamp()
           RETURNING s.user_id`,
          [oldSecretHash],
        );
        if (!revoked.rows[0]) return null;
        const created = await client.query<SavedRow>(
          `INSERT INTO sessions (user_id, secret_hash, created_at, expires_at)
           VALUES ($1, $2, statement_timestamp(), statement_timestamp() + ($3::integer * interval '1 second'))
           RETURNING id, user_id, expires_at`,
          [userId, newSecretHash, ttlSeconds],
        );
        const row = created.rows[0];
        if (!row) throw new Error('Session rotation insert returned no row');
        return { id: row.id, userId: row.user_id, expiresAt: row.expires_at };
      });
    },

    async revokeByHash(secretHash) {
      await pool.query(
        'UPDATE sessions SET revoked_at = statement_timestamp() WHERE secret_hash = $1 AND revoked_at IS NULL',
        [secretHash],
      );
    },

    async revokeAllForUser(userId) {
      await inTransaction(pool, async (client) => {
        await client.query(
          'SELECT id FROM users WHERE id = $1::uuid FOR UPDATE',
          [userId],
        );
        await client.query(
          'UPDATE sessions SET revoked_at = statement_timestamp() WHERE user_id = $1::uuid AND revoked_at IS NULL',
          [userId],
        );
      });
    },
  };
}
