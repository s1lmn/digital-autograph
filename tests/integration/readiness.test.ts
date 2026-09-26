import { buildApi } from '../../apps/api/src/app';
import { SessionService } from '../../packages/auth/src/index';
import {
  createDatabase,
  createPgSessionRepository,
} from '../../packages/db/src/index';
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
    const sessions = new SessionService(
      createPgSessionRepository(database.pool),
      1209600,
    );
    const app = buildApi(database, sessions, {
      appEnvironment: 'test',
      sessionTtlSeconds: 1209600,
      trustedWebOrigins: ['http://127.0.0.1:3000'],
    });
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
