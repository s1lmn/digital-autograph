import { createDatabase, sql } from '../../packages/db/src/index';
import { describe, expect, it, vi } from 'vitest';

function getTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (!value)
    throw new Error('TEST_DATABASE_URL is required for integration tests');
  const url = new URL(value);
  if (url.pathname !== '/autograph_test') {
    throw new Error(
      'Integration tests require the isolated autograph_test database',
    );
  }
  return value;
}

describe('PostgreSQL foundation', () => {
  it('connects and supports a transaction', async () => {
    const database = createDatabase(getTestDatabaseUrl());
    try {
      await database.checkConnection();
      const result = await database.transaction(async (tx) =>
        tx.execute(sql`SELECT 1 AS value`),
      );
      expect(result.rows[0]).toMatchObject({ value: 1 });
    } finally {
      await database.close();
    }
  });

  it('logs an idle backend termination safely and replaces the lost connection', async () => {
    const database = createDatabase(getTestDatabaseUrl());
    const control = createDatabase(getTestDatabaseUrl());
    const output = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const client = await database.pool.connect();
      let backendId: number;
      try {
        const result = await client.query<{ pid: number }>(
          'SELECT pg_backend_pid() AS pid',
        );
        backendId = result.rows[0]!.pid;
      } finally {
        client.release();
      }
      const terminated = await control.pool.query<{ terminated: boolean }>(
        'SELECT pg_terminate_backend($1) AS terminated',
        [backendId],
      );
      expect(terminated.rows[0]?.terminated).toBe(true);
      await vi.waitFor(() => expect(output).toHaveBeenCalledTimes(1));
      expect(output.mock.calls[0]).toHaveLength(1);
      const record = JSON.parse(output.mock.calls[0]![0] as string);
      expect(record).toEqual({
        level: 50,
        time: expect.any(String),
        event: 'POSTGRES_IDLE_CONNECTION_FAILED',
        err: { name: 'UnknownError', code: '57P01' },
        msg: 'PostgreSQL idle connection failed',
      });
      await database.checkConnection();
      const replacement = await database.pool.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      );
      expect(replacement.rows[0]!.pid).not.toBe(backendId);
    } finally {
      await Promise.all([database.close(), control.close()]);
      output.mockRestore();
    }
  });
});
