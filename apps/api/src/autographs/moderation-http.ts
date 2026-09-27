import {
  moderationAutographParams,
  moderationDecisionBody,
  moderationQueueQuery,
} from '@digital-autograph/contracts';
import {
  AutographError,
  type ModerationService,
} from '@digital-autograph/autographs';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { z } from 'zod';
import { authenticatedSession, requireAuthenticatedUser } from '../auth/http';

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

function sendError(error: unknown, reply: FastifyReply): unknown {
  if (!(error instanceof AutographError)) throw error;
  const status =
    error.code === 'FORBIDDEN'
      ? 403
      : error.code === 'AUTOGRAPH_NOT_FOUND'
        ? 404
        : error.code === 'INVALID_CURSOR'
          ? 400
          : 409;
  return reply.code(status).send({ error: { code: error.code } });
}

export function registerModerationRoutes(
  app: FastifyInstance,
  moderation: ModerationService,
): void {
  app.get(
    '/moderation/autographs',
    { preHandler: requireAuthenticatedUser },
    async (request, reply) => {
      const query = parse(moderationQueueQuery, request.query, reply);
      if (!query) return reply;
      reply.header('Cache-Control', 'no-store');
      try {
        return await moderation.list(
          authenticatedSession(request).user.id,
          query.limit,
          query.cursor,
        );
      } catch (error) {
        return sendError(error, reply);
      }
    },
  );

  app.get(
    '/moderation/autographs/:id/preview',
    { preHandler: requireAuthenticatedUser },
    async (request, reply) => {
      const params = parse(moderationAutographParams, request.params, reply);
      if (!params) return reply;
      reply.header('Cache-Control', 'no-store');
      try {
        return await moderation.preview(
          authenticatedSession(request).user.id,
          params.id,
        );
      } catch (error) {
        return sendError(error, reply);
      }
    },
  );

  app.post(
    '/moderation/autographs/:id/decision',
    { preHandler: requireAuthenticatedUser },
    async (request, reply) => {
      const params = parse(moderationAutographParams, request.params, reply);
      const body = parse(moderationDecisionBody, request.body, reply);
      if (!params || !body) return reply;
      reply.header('Cache-Control', 'no-store');
      try {
        return await moderation.decide(
          authenticatedSession(request).user.id,
          params.id,
          body,
        );
      } catch (error) {
        return sendError(error, reply);
      }
    },
  );
}
