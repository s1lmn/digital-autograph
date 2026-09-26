import { createDatabase, sql } from '../../packages/db/src/index';
import { describe, expect, it } from 'vitest';

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
});
