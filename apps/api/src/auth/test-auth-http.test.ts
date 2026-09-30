import { describe, expect, it, vi } from 'vitest';
import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { buildApi } from '../app';
import { registerTestAuthRoutes } from './test-auth-http';

const authConfig = {
  appEnvironment: 'test' as const,
  sessionTtlSeconds: 1200,
  trustedWebOrigins: ['http://127.0.0.1:3000'],
};

const testUserId = 'f1111111-1111-4111-8111-111111111111';
const token = `da_s1_${'a'.repeat(43)}`;

function createApi(testAuth?: {
  sessions: {
    createSession: (userId: string) => Promise<{
      token: string;
      sessionId: string;
      expiresAt: Date;
    }>;
  };
  userId: string;
  webOrigin: string;
}) {
  return buildApi(
    { checkConnection: async () => {} },
    {
      validateSession: async () => null,
      revokeSession: async () => {},
      revokeAllUserSessions: async () => {},
    },
    authConfig,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    testAuth,
  );
}

describe('test auth seam', () => {
  it('is not registered unless explicitly enabled by the API', async () => {
    const app = createApi();
    try {
      const response = await app.inject('/auth/test/start');
      expect(response.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('runs a callback, creates a normal session, and validates the return path', async () => {
    vi.stubEnv('ENABLE_TEST_AUTH_SEAM', 'true');
    const createSession = vi.fn(async () => ({
      token,
      sessionId: 'test-session',
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    }));
    const app = createApi({
      sessions: { createSession },
      userId: testUserId,
      webOrigin: 'http://127.0.0.1:3000',
    });
    try {
      const started = await app.inject(
        '/auth/test/start?returnTo=%2Fwalls%2Ffixture',
      );
      expect(started.statusCode).toBe(302);
      expect(started.headers.location).toBe(
        '/auth/test/callback?returnTo=%2Fwalls%2Ffixture',
      );

      const callbackLocation = started.headers.location;
      if (!callbackLocation)
        throw new Error('Test auth start did not redirect');
      const callback = await app.inject({
        method: 'GET',
        url: callbackLocation,
      });
      expect(callback.statusCode).toBe(302);
      expect(callback.headers.location).toBe(
        'http://127.0.0.1:3000/walls/fixture',
      );
      expect(callback.headers['set-cookie']).toContain('da_session=');
      expect(createSession).toHaveBeenCalledWith(testUserId);
    } finally {
      await app.close();
      vi.unstubAllEnvs();
    }
  });

  it('cannot be registered in a production environment', async () => {
    vi.stubEnv('ENABLE_TEST_AUTH_SEAM', 'true');
    const app = Fastify();
    try {
      await app.register(cookie);
      expect(() =>
        registerTestAuthRoutes(
          app,
          { createSession: vi.fn() },
          { ...authConfig, appEnvironment: 'production' },
          testUserId,
          'http://127.0.0.1:3000',
        ),
      ).toThrow(
        'Test auth seam requires ENABLE_TEST_AUTH_SEAM=true in a test environment',
      );

      vi.stubEnv('NODE_ENV', 'production');
      expect(() =>
        registerTestAuthRoutes(
          app,
          { createSession: vi.fn() },
          authConfig,
          testUserId,
          'http://127.0.0.1:3000',
        ),
      ).toThrow(
        'Test auth seam requires ENABLE_TEST_AUTH_SEAM=true in a test environment',
      );
    } finally {
      await app.close();
      vi.unstubAllEnvs();
    }
  });
});
