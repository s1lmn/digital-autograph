import { publicPlacementMediaParams } from '@digital-autograph/contracts';
import {
  PublicPlacementMediaError,
  type PublicPlacementMediaService,
} from '@digital-autograph/walls';
import type { FastifyInstance } from 'fastify';

export function registerPublicPlacementMediaRoutes(
  app: FastifyInstance,
  media: PublicPlacementMediaService,
): void {
  app.get(
    '/public/placements/:placementId/autograph',
    async (request, reply) => {
      const params = publicPlacementMediaParams.safeParse(request.params);
      if (!params.success) {
        return reply.code(404).header('Cache-Control', 'no-store').send();
      }
      try {
        const bytes = await media.getActivePng(params.data.placementId);
        return reply
          .header('Content-Type', 'image/png')
          .header('Content-Disposition', 'inline')
          .header('X-Content-Type-Options', 'nosniff')
          .header('Cache-Control', 'public, max-age=60')
          .send(bytes);
      } catch (error) {
        if (!(error instanceof PublicPlacementMediaError)) throw error;
        if (error.reason !== 'not_found') {
          app.log.warn(
            { placementId: params.data.placementId, reason: error.reason },
            'Public placement media unavailable',
          );
        }
        return reply.code(404).header('Cache-Control', 'no-store').send();
      }
    },
  );
}
