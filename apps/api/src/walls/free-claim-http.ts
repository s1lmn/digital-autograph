import { freeClaimBody, freeClaimParams } from '@digital-autograph/contracts';
import {
  FreeClaimError,
  type FreeClaimService,
} from '@digital-autograph/walls';
import type { FastifyInstance } from 'fastify';
import { authenticatedSession, requireAuthenticatedUser } from '../auth/http';

export function registerFreeClaimRoutes(
  app: FastifyInstance,
  claims: FreeClaimService,
): void {
  app.post(
    '/walls/:wallId/slots/:slotId/free-claim',
    { preHandler: requireAuthenticatedUser },
    async (request, reply) => {
      const params = freeClaimParams.safeParse(request.params);
      const body = freeClaimBody.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: { code: 'INVALID_REQUEST' } });
      }
      try {
        const claim = await claims.claimFreeSlot({
          userId: authenticatedSession(request).user.id,
          wallId: params.data.wallId,
          slotId: params.data.slotId,
          autographId: body.data.autographId,
        });
        const { created, ...response } = claim;
        return reply.code(created ? 201 : 200).send(response);
      } catch (error) {
        if (!(error instanceof FreeClaimError)) throw error;
        const status =
          error.code === 'WALL_NOT_FOUND' ||
          error.code === 'SLOT_NOT_FOUND' ||
          error.code === 'AUTOGRAPH_NOT_FOUND'
            ? 404
            : 409;
        return reply.code(status).send({ error: { code: error.code } });
      }
    },
  );
}
