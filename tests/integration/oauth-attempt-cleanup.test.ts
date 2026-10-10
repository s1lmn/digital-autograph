import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDatabase,
  createPgOAuthAttemptCleanup,
  createPgOAuthAttemptRepository,
} from '../../packages/db/src/index';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl || new URL(testDatabaseUrl).pathname !== '/autograph_test')
  throw new Error(
    'OAuth cleanup tests require the isolated autograph_test database',
  );

const database = createDatabase(testDatabaseUrl);
const cleanup = createPgOAuthAttemptCleanup(database.pool);
const attempts = createPgOAuthAttemptRepository(database.pool);

async function insertAttempts(
  count: number,
  expired = true,
  consumed = false,
  provider = 'google',
) {
  const result = await database.pool.query<{ id: string; state_hash: string }>(
    `INSERT INTO oauth_login_attempts
       (provider, state_hash, browser_binding_hash, nonce_hash, return_path,
        created_at, expires_at, consumed_at)
     SELECT $1, $2 || n::text, 'synthetic-binding', 'synthetic-nonce', '/',
       statement_timestamp() - interval '20 minutes',
       statement_timestamp() + ($3::integer * interval '1 minute'),
       CASE WHEN $4 THEN statement_timestamp() - interval '15 minutes' ELSE NULL END
     FROM generate_series(1, $5::integer) AS n
     RETURNING id, state_hash`,
    [provider, randomUUID(), expired ? -10 : 10, consumed, count],
  );
  return result.rows;
}

describe('bounded OAuth attempt cleanup with PostgreSQL', () => {
  beforeAll(async () => database.checkConnection());
  beforeEach(async () => {
    await database.pool.query('TRUNCATE TABLE oauth_login_attempts');
  });
  afterAll(async () => database.close());

  it('removes expired attempts from both providers and preserves all unexpired attempts', async () => {
    for (const provider of ['google', 'telegram']) {
      await insertAttempts(1, true, false, provider);
      await insertAttempts(1, true, true, provider);
      await insertAttempts(1, false, false, provider);
      await insertAttempts(1, false, true, provider);
    }
    expect(await cleanup()).toBe(4);
    const remaining = await database.pool.query(
      'SELECT provider, consumed_at FROM oauth_login_attempts ORDER BY provider, consumed_at NULLS FIRST',
    );
    expect(remaining.rows).toHaveLength(4);
    expect(remaining.rows.map((row) => row.provider)).toEqual([
      'google',
      'google',
      'telegram',
      'telegram',
    ]);
    expect(
      remaining.rows.filter((row) => row.consumed_at !== null),
    ).toHaveLength(2);
    expect(await cleanup()).toBe(0);
  });

  it('drains the oldest rows in bounded, repeatable batches', async () => {
    const oldest = await insertAttempts(3);
    await insertAttempts(4);
    expect(await cleanup(3)).toBe(3);
    const remaining = await database.pool.query(
      'SELECT id FROM oauth_login_attempts WHERE id = ANY($1::uuid[])',
      [oldest.map((row) => row.id)],
    );
    expect(remaining.rows).toHaveLength(0);
    expect(await cleanup(3)).toBe(3);
    expect(await cleanup(3)).toBe(1);
    expect(await cleanup(3)).toBe(0);
  });

  it('bounds the default batch and rejects invalid limits before deleting anything', async () => {
    await insertAttempts(1001);
    for (const limit of [0, -1, 1.5, 1001, NaN, Infinity])
      await expect(cleanup(limit)).rejects.toThrow(RangeError);
    expect(await cleanup()).toBe(1000);
    expect(await cleanup()).toBe(1);
  });

  it('lets concurrent workers drain disjoint batches without duplicate deletions', async () => {
    await insertAttempts(150);
    const counts = await Promise.all([cleanup(100), cleanup(100)]);
    expect(counts.every((count) => count <= 100)).toBe(true);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(150);
    expect(await cleanup()).toBe(0);
  });

  it('skips a locked expired row while an active callback can consume its attempt', async () => {
    const expired = await insertAttempts(2);
    const active = await insertAttempts(1, false);
    const locked = expired[0];
    const callback = active[0];
    if (!locked || !callback) throw new Error('Missing fixture');
    const client = await database.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT id FROM oauth_login_attempts WHERE id = $1 FOR UPDATE',
        [locked.id],
      );
      const [deleted, consumed] = await Promise.all([
        cleanup(),
        attempts.consume(callback.id),
      ]);
      expect(deleted).toBe(1);
      expect(consumed).toBe(true);
      expect(
        await attempts.findActive('google', callback.state_hash),
      ).toBeNull();
      const saved = await database.pool.query(
        'SELECT id FROM oauth_login_attempts WHERE id = $1',
        [callback.id],
      );
      expect(saved.rows).toHaveLength(1);
      await client.query('COMMIT');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    expect(await cleanup()).toBe(1);
    expect(await cleanup()).toBe(0);
  });

  it('times out a table lock, rolls back and recovers on the next cleanup', async () => {
    await insertAttempts(1);
    const client = await database.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'LOCK TABLE oauth_login_attempts IN ACCESS EXCLUSIVE MODE',
      );
      await expect(cleanup()).rejects.toMatchObject({ code: '55P03' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    expect(await cleanup()).toBe(1);
    const settings = await database.pool.query('SHOW lock_timeout');
    expect(settings.rows[0]?.lock_timeout).toBe('0');
  });
});
