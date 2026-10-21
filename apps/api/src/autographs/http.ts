import {
  autographIdParams,
  approveAutographBody,
  completeOriginalUploadBody,
  createAutographBody,
  initiateOriginalUploadBody,
  readyAutographListQuery,
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
    error.code === 'AUTOGRAPH_NOT_FOUND' || error.code === 'UPLOAD_NOT_FOUND'
      ? 404
      : error.code === 'FORBIDDEN'
        ? 403
        : error.code === 'UPLOAD_TOO_LARGE'
          ? 413
          : [
                'CLEANED_PREVIEW_NOT_AVAILABLE',
                'INVALID_AUTOGRAPH_STATE',
                'AUTOGRAPH_NOT_AWAITING_APPROVAL',
                'CLEANED_ASSET_NOT_AVAILABLE',
                'REVIEWED_ASSET_MISMATCH',
                'APPROVAL_STATE_INCONSISTENT',
                'MODERATION_STATE_INCONSISTENT',
              ].includes(error.code)
            ? 409
            : 400;
  return reply.code(status).send({ error: { code: error.code } });
}

export function registerAutographRoutes(
  app: FastifyInstance,
  autographs: AutographService,
): void {
  app.get(
    '/autographs',
    { preHandler: requireAuthenticatedUser },
    async (request, reply) => {
      const query = parse(readyAutographListQuery, request.query, reply);
      if (!query) return reply;
      reply.header('Cache-Control', 'no-store');
      return autographs.listReadyOwned(authenticatedSession(request).user.id);
    },
  );

  app.post(
    '/autographs',
    {
      config: { firstUse: true },
      preHandler: requireAuthenticatedUser,
    },
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
    {
      config: { firstUse: true },
      preHandler: requireAuthenticatedUser,
    },
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
    {
      config: { firstUse: true },
      preHandler: requireAuthenticatedUser,
    },
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

  app.post(
    '/autographs/:id/approve',
    {
      config: { firstUse: true },
      preHandler: requireAuthenticatedUser,
    },
    async (request, reply) => {
      const params = parse(autographIdParams, request.params, reply);
      const body = parse(approveAutographBody, request.body, reply);
      if (!params || !body) return reply;
      reply.header('Cache-Control', 'no-store');
      try {
        return await autographs.approveCleanedAutograph(
          authenticatedSession(request).user.id,
          params.id,
          body.reviewedAssetId,
        );
      } catch (error) {
        return sendError(error, reply);
      }
    },
  );
}
