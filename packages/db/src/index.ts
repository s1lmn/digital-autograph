import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

export { eq, sql } from 'drizzle-orm';

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
