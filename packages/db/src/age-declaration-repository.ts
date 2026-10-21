import type { Pool } from 'pg';
import type { AgeDeclarationRepository } from '@digital-autograph/domain';
export function createPgAgeDeclarationRepository(
  pool: Pool,
): AgeDeclarationRepository {
  return {
    async declaredAt(userId) {
      const r = await pool.query<{ declared_at: Date }>(
        'SELECT declared_at FROM age_declarations WHERE user_id=$1::uuid',
        [userId],
      );
      return r.rows[0]?.declared_at ?? null;
    },
    async declareAdult(userId) {
      // One durable declaration per subject; concurrent retries return the original DB clock.
      await pool.query(
        'INSERT INTO age_declarations(user_id) VALUES($1::uuid) ON CONFLICT (user_id) DO NOTHING',
        [userId],
      );
      const r = await pool.query<{ declared_at: Date }>(
        'SELECT declared_at FROM age_declarations WHERE user_id=$1::uuid',
        [userId],
      );
      if (!r.rows[0]) throw new Error('Age declaration unavailable');
      return r.rows[0].declared_at;
    },
  };
}
