import { describe, expect, it } from 'vitest';
import { buildApi } from './app';

const sessionService = {
  validateSession: async () => null,
  revokeSession: async () => {},
  revokeAllUserSessions: async () => {},
};

const authConfig = {
  appEnvironment: 'test' as const,
  sessionTtlSeconds: 1_209_600,
  trustedWebOrigins: ['http://127.0.0.1:3000'],
};

describe('API health', () => {
  it('reports process liveness without requiring a database query', async () => {
    const app = buildApi(
      { checkConnection: async () => {} },
      sessionService,
      authConfig,
    );
    try {
      const response = await app.inject('/health/live');
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
    } finally {
      await app.close();
    }
  });

  it('reports unready when the database cannot be reached', async () => {
    const app = buildApi(
      {
        checkConnection: async () => {
          throw new Error('database unavailable');
        },
      },
      sessionService,
      authConfig,
    );
    try {
      const response = await app.inject('/health/ready');
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: 'unavailable' });
    } finally {
      await app.close();
    }
  });
});
