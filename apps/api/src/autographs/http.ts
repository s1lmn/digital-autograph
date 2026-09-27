import {
  autographIdParams,
  completeOriginalUploadBody,
  createAutographBody,
  initiateOriginalUploadBody,
} from '@digital-autograph/contracts';
import {
  AutographError,
  type AutographService,
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
    error.code === 'AUTOGRAPH_NOT_FOUND'
      ? 404
      : error.code === 'FORBIDDEN'
        ? 403
        : error.code === 'UPLOAD_NOT_FOUND'
          ? 404
          : error.code === 'CLEANED_PREVIEW_NOT_AVAILABLE'
            ? 409
            : error.code === 'INVALID_AUTOGRAPH_STATE'
              ? 409
              : error.code === 'UPLOAD_TOO_LARGE'
                ? 413
                : 400;
  return reply.code(status).send({ error: { code: error.code } });
}

export function registerAutographRoutes(
  app: FastifyInstance,
  autographs: AutographService,
): void {
  app.post(
    '/autographs',
    { preHandler: requireAuthenticatedUser },
    async (request, reply) => {
      const body = parse(createAutographBody, request.body, reply);
      if (!body) return reply;
      try {
        return reply
          .code(201)
          .send(
            await autographs.create(
              authenticatedSession(request).user.id,
              body.source,
            ),
          );
      } catch (error) {
        return sendError(error, reply);
      }
    },
  );

  app.get(
    '/autographs/:id',
    { preHandler: requireAuthenticatedUser },
    async (request, reply) => {
      const params = parse(autographIdParams, request.params, reply);
      if (!params) return reply;
      try {
        return await autographs.get(
          authenticatedSession(request).user.id,
          params.id,
        );
      } catch (error) {
        return sendError(error, reply);
      }
    },
  );

  app.post(
    '/autographs/:id/upload',
    { preHandler: requireAuthenticatedUser },
    async (request, reply) => {
      const params = parse(autographIdParams, request.params, reply);
      const body = parse(initiateOriginalUploadBody, request.body, reply);
      if (!params || !body) return reply;
      try {
        return await autographs.initiateUpload(
          authenticatedSession(request).user.id,
          params.id,
          body,
        );
      } catch (error) {
        return sendError(error, reply);
      }
    },
  );

  app.post(
    '/autographs/:id/upload/complete',
    { preHandler: requireAuthenticatedUser },
    async (request, reply) => {
      const params = parse(autographIdParams, request.params, reply);
      const body = parse(completeOriginalUploadBody, request.body ?? {}, reply);
      if (!params || !body) return reply;
      try {
        return await autographs.completeUpload(
          authenticatedSession(request).user.id,
          params.id,
        );
      } catch (error) {
        return sendError(error, reply);
      }
    },
  );

  app.get(
    '/autographs/:id/preview',
    { preHandler: requireAuthenticatedUser },
    async (request, reply) => {
      const params = parse(autographIdParams, request.params, reply);
      if (!params) return reply;
      reply.header('Cache-Control', 'no-store');
      try {
        return await autographs.preview(
          authenticatedSession(request).user.id,
          params.id,
        );
      } catch (error) {
        return sendError(error, reply);
      }
    },
  );
}
