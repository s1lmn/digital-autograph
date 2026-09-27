import type { OAuthAttemptRepository } from '@digital-autograph/auth';
import type { Pool } from 'pg';

type AttemptRow = {
  id: string;
  browser_binding_hash: string;
  nonce_hash: string;
  pkce_verifier_hash: string | null;
  return_path: string;
};

export function createPgOAuthAttemptRepository(
  pool: Pool,
): OAuthAttemptRepository {
  return {
    async create(input) {
      await pool.query(
        `INSERT INTO oauth_login_attempts
           (provider, state_hash, browser_binding_hash, nonce_hash, pkce_verifier_hash, return_path,
            created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6,
                 statement_timestamp(), statement_timestamp() + ($7::integer * interval '1 second'))`,
        [
          input.provider,
          input.stateHash,
          input.browserBindingHash,
          input.nonceHash,
          input.pkceVerifierHash,
          input.returnPath,
          input.ttlSeconds,
        ],
      );
    },

    async findActive(provider, stateHash) {
      const result = await pool.query<AttemptRow>(
        `SELECT id, browser_binding_hash, nonce_hash, pkce_verifier_hash, return_path
         FROM oauth_login_attempts
         WHERE provider = $1 AND state_hash = $2
           AND consumed_at IS NULL AND expires_at > statement_timestamp()`,
        [provider, stateHash],
      );
      const row = result.rows[0];
      return row
        ? {
            id: row.id,
            browserBindingHash: row.browser_binding_hash,
            nonceHash: row.nonce_hash,
            pkceVerifierHash: row.pkce_verifier_hash,
            returnPath: row.return_path,
          }
        : null;
    },

    async consume(id) {
      const result = await pool.query(
        `UPDATE oauth_login_attempts SET consumed_at = statement_timestamp()
         WHERE id = $1::uuid AND consumed_at IS NULL
           AND expires_at > statement_timestamp()
         RETURNING id`,
        [id],
      );
      return result.rowCount === 1;
    },
  };
}
