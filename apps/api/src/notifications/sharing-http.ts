import {
  notificationIdParams,
  shareCreateBody,
  shareInteractionBody,
} from '@digital-autograph/contracts';
import {
  NotificationError,
  type ShareRepository,
} from '@digital-autograph/notifications';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticatedSession, requireAuthenticatedUser } from '../auth/http';
import { renderShareCard } from './share-card';
export function registerSharingRoutes(
  app: FastifyInstance,
  repository: ShareRepository,
) {
  app.register(async (app) => {
    app.setErrorHandler((error, _request, reply) => {
      const status =
        error instanceof NotificationError
          ? error.code === 'RATE_LIMITED'
            ? 429
            : 404
          : error instanceof z.ZodError
            ? 400
            : 500;
      return reply.code(status).send({
        error: {
          code:
            status === 400
              ? 'INVALID_REQUEST'
              : status === 404
                ? 'NOT_FOUND'
                : status === 429
                  ? 'RATE_LIMITED'
                  : 'REQUEST_FAILURE',
        },
      });
    });
    app.addHook('onSend', async (_request, reply, payload) => {
      reply.header('Cache-Control', 'no-store');
      return payload;
    });
    app.post(
      '/me/shares',
      { preHandler: requireAuthenticatedUser },
      (request) => {
        const body = shareCreateBody.parse(request.body);
        return repository.create(authenticatedSession(request).user.id, body);
      },
    );
    app.delete(
      '/me/shares/:id',
      { preHandler: requireAuthenticatedUser },
      async (request, reply) => {
        await repository.revoke(
          authenticatedSession(request).user.id,
          notificationIdParams.parse(request.params).id,
        );
        return reply.code(204).send();
      },
    );
    app.get('/public/shares/:id', async (request) => {
      const share = await repository.public(
        notificationIdParams.parse(request.params).id,
      );
      if (!share) throw new NotificationError('NOT_FOUND');
      return share;
    });
    app.get('/public/shares/:id/card', async (request, reply) => {
      const share = await repository.public(
        notificationIdParams.parse(request.params).id,
      );
      if (!share) throw new NotificationError('NOT_FOUND');
      return reply
        .type('image/png')
        .header('X-Content-Type-Options', 'nosniff')
        .send(await renderShareCard(share));
    });
    app.post('/public/shares/:id/interactions', async (request, reply) => {
      const body = shareInteractionBody.parse(request.body);
      await repository.interact(
        notificationIdParams.parse(request.params).id,
        body.kind,
        body.dedupeKey,
      );
      return reply.code(204).send();
    });
  });
}
