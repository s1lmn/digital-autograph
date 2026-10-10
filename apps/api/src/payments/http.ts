import { LegalError } from '@digital-autograph/domain';
import { z } from 'zod';
import { PaymentError, type PaymentService } from '@digital-autograph/payments';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyError,
  FastifyRequest,
} from 'fastify';
import { authenticatedSession, requireAuthenticatedUser } from '../auth/http';
import { rejectDisabledOperation } from '../incident-controls';
const createBody = z
  .object({ reservationId: z.uuid(), autographId: z.uuid() })
  .strict();
const params = z.object({ id: z.uuid() });
const webhook = z.object({
  type: z.literal('notification'),
  event: z.enum([
    'payment.succeeded',
    'payment.canceled',
    'payment.waiting_for_capture',
  ]),
  object: z.object({ id: z.uuid() }),
});
function sendError(error: unknown, reply: FastifyReply) {
  if (error instanceof LegalError)
    return reply.code(409).send({ error: { code: error.code } });
  if (!(error instanceof PaymentError))
    return reply.code(503).send({ error: { code: 'PAYMENT_UNAVAILABLE' } });
  const code = error.code;
  return reply
    .code(
      code.endsWith('NOT_FOUND')
        ? 404
        : code === 'PAYMENT_BUSY' || code === 'PROVIDER_UNAVAILABLE'
          ? 503
          : 409,
    )
    .send({ error: { code } });
}
function parserError(
  error: FastifyError,
  _request: FastifyRequest,
  reply: FastifyReply,
) {
  // Parser errors may contain snippets of raw JSON. Never send/log provider bodies.
  return reply
    .code(error.statusCode === 413 ? 413 : 400)
    .send({ error: { code: 'INVALID_REQUEST' } });
}
// Two fixed counters per route group; no client-keyed memory or unbounded queue.
function capacity() {
  let window = Date.now(),
    used = 0,
    active = 0;
  return {
    acquire() {
      if (Date.now() - window >= 60_000) {
        window = Date.now();
        used = 0;
      }
      if (used >= 60 || active >= 4) return false;
      used++;
      active++;
      return true;
    },
    release() {
      active--;
    },
  };
}
export function registerPaymentRoutes(
  app: FastifyInstance,
  payments: PaymentService,
  disabled = false,
) {
  // Fixed independent budgets: user traffic cannot consume webhook capacity.
  // Perimeter aggregate limits are still required across multiple replicas.
  const users = capacity();
  const callbacks = capacity();
  app.post(
    '/payments/orders',
    {
      preHandler: [
        requireAuthenticatedUser,
        rejectDisabledOperation(disabled, 'NEW_PAYMENTS_DISABLED'),
      ],
      bodyLimit: 2048,
      errorHandler: parserError,
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      const body = createBody.safeParse(req.body);
      if (!body.success)
        return reply.code(400).send({ error: { code: 'INVALID_REQUEST' } });
      if (!users.acquire())
        return reply.code(429).send({ error: { code: 'RATE_LIMITED' } });
      try {
        return await payments.create(
          authenticatedSession(req).user.id,
          body.data.reservationId,
          body.data.autographId,
        );
      } catch (e) {
        return sendError(e, reply);
      } finally {
        users.release();
      }
    },
  );
  app.get(
    '/payments/orders/:id',
    { preHandler: requireAuthenticatedUser },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      const parsed = params.safeParse(req.params);
      if (!parsed.success)
        return reply.code(400).send({ error: { code: 'INVALID_REQUEST' } });
      try {
        return await payments.status(
          authenticatedSession(req).user.id,
          parsed.data.id,
        );
      } catch (e) {
        return sendError(e, reply);
      }
    },
  );
  app.post(
    '/payments/orders/:id/refresh',
    {
      preHandler: requireAuthenticatedUser,
      bodyLimit: 1024,
      errorHandler: parserError,
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      const parsed = params.safeParse(req.params);
      if (
        !parsed.success ||
        !z
          .object({})
          .strict()
          .safeParse(req.body ?? {}).success
      )
        return reply.code(400).send({ error: { code: 'INVALID_REQUEST' } });
      if (!users.acquire())
        return reply.code(429).send({ error: { code: 'RATE_LIMITED' } });
      try {
        return await payments.refresh(
          authenticatedSession(req).user.id,
          parsed.data.id,
        );
      } catch (e) {
        return sendError(e, reply);
      } finally {
        users.release();
      }
    },
  );
  app.post(
    '/payments/webhooks/yookassa',
    { bodyLimit: 16384, errorHandler: parserError },
    async (req, reply) => {
      const body = webhook.safeParse(req.body);
      if (!body.success)
        return reply.code(400).send({ error: { code: 'INVALID_REQUEST' } });
      if (!callbacks.acquire())
        return reply.code(429).send({ error: { code: 'RATE_LIMITED' } });
      try {
        await payments.webhook(body.data.object.id, body.data.event);
        return { received: true };
      } catch (e) {
        return sendError(e, reply);
      } finally {
        callbacks.release();
      }
    },
  );
}
