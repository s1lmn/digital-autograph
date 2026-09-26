import { buildApi } from '../../apps/api/src/app';
import { createDatabase } from '../../packages/db/src/index';
import { describe, expect, it } from 'vitest';

describe('API readiness with PostgreSQL', () => {
  it('reports ready when the test database is reachable', async () => {
    const value = process.env.TEST_DATABASE_URL;
    if (!value)
      throw new Error('TEST_DATABASE_URL is required for integration tests');
    const url = new URL(value);
    if (url.pathname !== '/autograph_test') {
      throw new Error(
        'Integration tests require the isolated autograph_test database',
      );
    }
    const database = createDatabase(value);
    const app = buildApi(database);
    try {
      const response = await app.inject('/health/ready');
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ready' });
    } finally {
      await app.close();
      await database.close();
    }
  });
});
