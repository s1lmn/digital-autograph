import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlacementHistoryService } from '@digital-autograph/walls';
import { buildApi } from '../app';

const userId = '00000000-0000-4000-8000-000000000001';
const token = `da_s1_${'a'.repeat(43)}`;
const startedAt = new Date('2026-09-28T12:00:00.000Z');

function api() {
  const session = {
    sessionId: 'session',
    user: { id: userId, status: 'active' as const },
    expiresAt: new Date('2026-10-01T12:00:00.000Z'),
  };
  const history = new PlacementHistoryService({
    listPublicWallHistory: async (wallId) =>
      wallId === '00000000-0000-4000-8000-000000000002'
        ? [
            {
              wallId,
              wallSlug: 'public-creator',
              wallDisplayName: 'Public Creator',
              wallIsPublic: true,
              slotPosition: 0,
              source: 'free_claim' as const,
              startedAt,
              endedAt: new Date('2026-09-29T12:00:00.000Z'),
              endReason: 'private-details-that-must-not-leak',
            },
          ]
        : null,
    listUserHistory: async (requestedUserId) => [
      {
        wallId: '00000000-0000-4000-8000-000000000002',
        wallSlug: 'public-creator',
        wallDisplayName: 'Public Creator',
        wallIsPublic: true,
        slotPosition: 0,
        source: 'free_claim' as const,
        startedAt,
        endedAt: null,
        endReason: requestedUserId === userId ? null : 'unexpected',
      },
    ],
  });
  return buildApi(
    { checkConnection: async () => {} },
    {
      validateSession: async (value) => (value === token ? session : null),
      revokeSession: async () => {},
      revokeAllUserSessions: async () => {},
    },
    {
      appEnvironment: 'test',
      sessionTtlSeconds: 1200,
      trustedWebOrigins: ['http://127.0.0.1:3000'],
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    history,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('placement history routes', () => {
  it('returns safe public placement data without User or Autograph identifiers', async () => {
    const app = api();
    try {
      const response = await app.inject(
        '/walls/00000000-0000-4000-8000-000000000002/placements',
      );
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({
        wallId: '00000000-0000-4000-8000-000000000002',
        placements: [
          {
            slotPosition: 0,
            source: 'free_claim',
            startedAt: startedAt.toISOString(),
            endedAt: '2026-09-29T12:00:00.000Z',
            endReason: 'other',
          },
        ],
      });
      expect(response.body).not.toContain(userId);
      expect(response.body).not.toContain('private-details');
      expect(response.body).not.toContain('autographId');
    } finally {
      await app.close();
    }
  });

  it('requires a session and scopes personal history to its authenticated User', async () => {
    const app = api();
    try {
      const anonymous = await app.inject('/me/placements');
      expect(anonymous.statusCode).toBe(401);

      const response = await app.inject({
        url: '/me/placements',
        headers: { cookie: `da_session=${token}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json().items).toMatchObject([
        {
          wallDisplayName: 'Public Creator',
          wallIsPublic: true,
          slotPosition: 0,
          source: 'free_claim',
          endReason: null,
        },
      ]);
    } finally {
      await app.close();
    }
  });

  it('hides private Wall history and rejects malformed IDs', async () => {
    const app = api();
    try {
      const privateWall = await app.inject(
        '/walls/00000000-0000-4000-8000-000000000003/placements',
      );
      expect(privateWall.statusCode).toBe(404);
      expect(privateWall.json()).toEqual({
        error: { code: 'WALL_NOT_FOUND' },
      });
      const malformed = await app.inject('/walls/not-a-uuid/placements');
      expect(malformed.statusCode).toBe(400);
      expect(malformed.json()).toEqual({
        error: { code: 'INVALID_REQUEST' },
      });
    } finally {
      await app.close();
    }
  });
});
