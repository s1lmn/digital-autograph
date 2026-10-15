import {
  createTakeoverReservationBody,
  emptyReservationBody,
  takeoverReservationParams,
} from '@digital-autograph/contracts';
import {
  ReservationError,
  type TakeoverReservationService,
} from '@digital-autograph/walls';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { authenticatedSession, requireAuthenticatedUser } from '../auth/http';
import { rejectDisabledOperation } from '../incident-controls';

function sendReservationError(error: unknown, reply: FastifyReply): unknown {
  if (!(error instanceof ReservationError)) throw error;
  if (
    error.code === 'USER_RESERVATION_ACTIVE' ||
    error.code === 'RESERVATION_RATE_LIMITED'
  ) {
    reply.header('Retry-After', error.retryAfterSeconds ?? 60);
    return reply.code(429).send({ error: { code: error.code } });
  }
  const status =
    error.code === 'QUOTE_NOT_FOUND' || error.code === 'RESERVATION_NOT_FOUND'
      ? 404
      : error.code === 'IDEMPOTENCY_KEY_REQUIRED' ||
          error.code === 'INVALID_IDEMPOTENCY_KEY'
        ? 400
        : 409;
  return reply.code(status).send({ error: { code: error.code } });
}

export function registerTakeoverReservationRoutes(
  app: FastifyInstance,
  reservations: TakeoverReservationService,
  disabled = false,
): void {
  app.post(
    '/takeover-reservations',
    {
      preHandler: [
        requireAuthenticatedUser,
        rejectDisabledOperation(disabled, 'NEW_PAYMENTS_DISABLED'),
      ],
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const body = createTakeoverReservationBody.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: { code: 'INVALID_REQUEST' } });
      }
      try {
        const result = await reservations.create(
          authenticatedSession(request).user.id,
          body.data.quoteId,
          request.headers['idempotency-key'],
        );
        return reply.code(result.created ? 201 : 200).send(result.reservation);
      } catch (error) {
        return sendReservationError(error, reply);
      }
    },
  );

  app.get(
    '/takeover-reservations/:id',
    { preHandler: requireAuthenticatedUser },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const params = takeoverReservationParams.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: { code: 'INVALID_REQUEST' } });
      }
      try {
        return await reservations.findOwned(
          authenticatedSession(request).user.id,
          params.data.id,
        );
      } catch (error) {
        return sendReservationError(error, reply);
      }
    },
  );

  app.post(
    '/takeover-reservations/:id/cancel',
    { preHandler: requireAuthenticatedUser },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const params = takeoverReservationParams.safeParse(request.params);
      const body = emptyReservationBody.safeParse(
        request.body === undefined ? {} : request.body,
      );
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: { code: 'INVALID_REQUEST' } });
      }
      try {
        return await reservations.cancelOwned(
          authenticatedSession(request).user.id,
          params.data.id,
        );
      } catch (error) {
        return sendReservationError(error, reply);
      }
    },
  );
}
