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

describe('API response security', () => {
  it.each([
    { url: '/health/live', status: 200 },
    { url: '/health/live', method: 'HEAD' as const, status: 200 },
    { url: '/health/ready', status: 503 },
    { url: '/auth/me', status: 401 },
    { url: '/missing', status: 404 },
    { url: '/failure', status: 500 },
    {
      url: '/auth/logout',
      method: 'POST' as const,
      headers: {
        origin: 'https://untrusted.example.test',
        cookie: 'da_session=synthetic-token',
      },
      status: 403,
    },
    {
      url: '/auth/me',
      method: 'OPTIONS' as const,
      headers: {
        origin: 'http://127.0.0.1:3000',
        'access-control-request-method': 'GET',
      },
      status: 204,
    },
    { url: '/auth/me', method: 'OPTIONS' as const, status: 400 },
  ])('protects $method $url ($status)', async ({ status, ...request }) => {
    const app = buildApi(
      {
        checkConnection: async () => {
          throw new Error('unavailable');
        },
      },
      sessionService,
      authConfig,
    );
    app.get('/failure', async () => {
      throw new Error('synthetic failure');
    });
    try {
      const response = await app.inject(request);
      expect(response.statusCode).toBe(status);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['content-security-policy']).toBe(
        "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
      );
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      if (status === 204) {
        expect(response.headers['access-control-allow-origin']).toBe(
          'http://127.0.0.1:3000',
        );
        expect(response.headers['access-control-allow-credentials']).toBe(
          'true',
        );
        expect(response.body).toBe('');
      }
    } finally {
      await app.close();
    }
  });
});
