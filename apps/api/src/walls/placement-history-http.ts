import { wallIdParams } from '@digital-autograph/contracts';
import type { PlacementHistoryService } from '@digital-autograph/walls';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { authenticatedSession, requireAuthenticatedUser } from '../auth/http';

function wallId(value: unknown, reply: FastifyReply): string | undefined {
  const parsed = wallIdParams.safeParse(value);
  if (parsed.success) return parsed.data.id;
  reply.code(400).send({ error: { code: 'INVALID_REQUEST' } });
  return undefined;
}

export function registerPlacementHistoryRoutes(
  app: FastifyInstance,
  history: PlacementHistoryService,
): void {
  app.get('/walls/:id/placements', async (request, reply) => {
    const id = wallId(request.params, reply);
    if (!id) return reply;
    reply.header('Cache-Control', 'no-store');
    const result = await history.getPublicWallHistory(id);
    if (!result) {
      return reply.code(404).send({ error: { code: 'WALL_NOT_FOUND' } });
    }
    return result;
  });

  app.get(
    '/me/placements',
    { preHandler: requireAuthenticatedUser },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const userId = authenticatedSession(request).user.id;
      return { items: await history.getUserHistory(userId) };
    },
  );
}
