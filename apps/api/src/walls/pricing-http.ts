import {
  assignWallPricingBody,
  assignWallPricingParams,
  createPricingConfigBody,
  takeoverQuoteBody,
  takeoverQuoteParams,
} from '@digital-autograph/contracts';
import {
  PricingError,
  type TakeoverQuoteService,
} from '@digital-autograph/walls';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { z } from 'zod';
import { authenticatedSession, requireAuthenticatedUser } from '../auth/http';
import { rejectDisabledOperation } from '../incident-controls';

function parse<T extends z.ZodType>(
  schema: T,
  value: unknown,
  reply: FastifyReply,
): z.output<T> | undefined {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  reply.code(400).send({ error: { code: 'INVALID_REQUEST' } });
  return undefined;
}

function sendPricingError(error: unknown, reply: FastifyReply): unknown {
  if (!(error instanceof PricingError)) throw error;
  const status =
    error.code === 'FORBIDDEN'
      ? 403
      : error.code === 'WALL_NOT_FOUND' ||
          error.code === 'SLOT_NOT_FOUND' ||
          error.code === 'PRICING_CONFIG_NOT_FOUND'
        ? 404
        : error.code === 'INVALID_PRICING_CONFIG'
          ? 400
          : 409;
  return reply.code(status).send({
    error: {
      code: error.code,
      ...(error.availableAt && { availableAt: error.availableAt }),
    },
  });
}

export function registerPricingRoutes(
  app: FastifyInstance,
  pricing: TakeoverQuoteService,
  disabled = false,
): void {
  app.post(
    '/admin/pricing/configs',
    { preHandler: requireAuthenticatedUser },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const body = parse(createPricingConfigBody, request.body, reply);
      if (!body) return reply;
      const actorUserId = authenticatedSession(request).user.id;
      try {
        const created = await pricing.createConfig(
          actorUserId,
          {
            algorithmVersion: body.algorithmVersion,
            currency: body.currency,
            baseAmountMinor: BigInt(body.baseAmountMinor),
            minimumAmountMinor: BigInt(body.minimumAmountMinor),
            maximumAmountMinor: BigInt(body.maximumAmountMinor),
            dynamicTakeoverLimit: body.dynamicTakeoverLimit,
            takeoverStepSize: body.takeoverStepSize,
            stepAmountMinor: BigInt(body.stepAmountMinor),
            decayIntervalSeconds: body.decayIntervalSeconds,
            decayAmountMinor: BigInt(body.decayAmountMinor),
            decayFloorAmountMinor: BigInt(body.decayFloorAmountMinor),
            guaranteedVisibilitySeconds: body.guaranteedVisibilitySeconds,
          },
          body.activateForNewWalls,
        );
        request.log.info(
          {
            pricingConfigId: created.id,
            actorUserId,
            activeForNewWalls: created.activeForNewWalls,
          },
          'Pricing config version created',
        );
        return reply.code(201).send(created);
      } catch (error) {
        return sendPricingError(error, reply);
      }
    },
  );

  app.post(
    '/admin/walls/:wallId/pricing-config',
    { preHandler: requireAuthenticatedUser },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const params = parse(assignWallPricingParams, request.params, reply);
      const body = parse(assignWallPricingBody, request.body, reply);
      if (!params || !body) return reply;
      const actorUserId = authenticatedSession(request).user.id;
      try {
        const assigned = await pricing.assignWallConfig(
          actorUserId,
          params.wallId,
          body.pricingConfigId,
        );
        request.log.info(
          { ...assigned, actorUserId },
          'Wall pricing config version assigned',
        );
        return reply.code(200).send(assigned);
      } catch (error) {
        return sendPricingError(error, reply);
      }
    },
  );

  app.post(
    '/walls/:wallId/slots/:slotId/takeover-quote',
    {
      preHandler: [
        requireAuthenticatedUser,
        rejectDisabledOperation(disabled, 'NEW_PAYMENTS_DISABLED'),
      ],
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const params = parse(takeoverQuoteParams, request.params, reply);
      const body = parse(
        takeoverQuoteBody,
        request.body === undefined ? {} : request.body,
        reply,
      );
      if (!params || !body) return reply;
      try {
        const quote = await pricing.createQuote({
          userId: authenticatedSession(request).user.id,
          wallId: params.wallId,
          slotId: params.slotId,
        });
        return reply.code(201).send(quote);
      } catch (error) {
        return sendPricingError(error, reply);
      }
    },
  );
}
