import { describe, expect, it } from 'vitest';
import { buildApi } from './app';

describe('API health', () => {
  it('reports process liveness without requiring a database query', async () => {
    const app = buildApi({ checkConnection: async () => {} });
    try {
      const response = await app.inject('/health/live');
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
    } finally {
      await app.close();
    }
  });

  it('reports unready when the database cannot be reached', async () => {
    const app = buildApi({
      checkConnection: async () => {
        throw new Error('database unavailable');
      },
    });
    try {
      const response = await app.inject('/health/ready');
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: 'unavailable' });
    } finally {
      await app.close();
    }
  });
});
