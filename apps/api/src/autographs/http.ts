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
import { z } from 'zod';
import type { Readable } from 'node:stream';
import { readOriginalBody } from './bounded-body';
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
  const statuses: Partial<Record<AutographError['code'], number>> = {
    AUTOGRAPH_NOT_FOUND: 404,
    UPLOAD_NOT_FOUND: 404,
    FORBIDDEN: 403,
    UPLOAD_BUSY: 429,
    UPLOAD_QUOTA_EXCEEDED: 429,
    UPLOAD_TIMEOUT: 408,
    UPLOAD_EXPIRED: 410,
    UPLOAD_ALREADY_EXISTS: 412,
    UPLOAD_TOO_LARGE: 413,
    CLEANED_PREVIEW_NOT_AVAILABLE: 409,
    INVALID_AUTOGRAPH_STATE: 409,
    AUTOGRAPH_NOT_AWAITING_APPROVAL: 409,
    CLEANED_ASSET_NOT_AVAILABLE: 409,
    REVIEWED_ASSET_MISMATCH: 409,
    APPROVAL_STATE_INCONSISTENT: 409,
    MODERATION_STATE_INCONSISTENT: 409,
  };
  const status = statuses[error.code] ?? 400;
  if (status === 429)
    reply.header('Retry-After', error.code === 'UPLOAD_BUSY' ? '2' : '60');
  return reply.code(status).send({ error: { code: error.code } });
}

export function registerAutographRoutes(
  app: FastifyInstance,
  autographs: AutographService,
): void {
  // Parser returns the untouched stream. Authentication, ownership and the shared
  // PostgreSQL permit run BEFORE any application buffering.
  app.addContentTypeParser(
    ['image/png', 'image/jpeg'],
    (_request, payload, done) => done(null, payload),
  );
  let activeBodies = 0;
  app.put(
    '/autographs/:id/upload/:assetId',
    {
      config: { firstUse: true },
      onRequest: async (_request, reply) => {
        if (activeBodies >= 4)
          return reply.code(429).send({ error: { code: 'UPLOAD_BUSY' } });
        activeBodies++;
        reply.raw.once('close', () => {
          activeBodies--;
        });
      },
      preHandler: requireAuthenticatedUser,
    },
    async (request, reply) => {
      const params = parse(
        z.object({ id: z.uuid(), assetId: z.uuid() }).strict(),
        request.params,
        reply,
      );
      if (!params) return reply;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      const abort = () => controller.abort();
      request.raw.once('aborted', abort);
      reply.header('Cache-Control', 'no-store');
      try {
        await autographs.uploadOriginal(
          authenticatedSession(request).user.id,
          params.id,
          params.assetId,
          request.headers['content-type'] ?? '',
          (expected) =>
            readOriginalBody(
              request.body as Readable,
              expected,
              controller.signal,
            ),
          controller.signal,
        );
        return reply.code(204).send();
      } catch (error) {
        if (!request.raw.complete) {
          reply.header('Connection', 'close');
          reply.raw.once('finish', () => request.raw.destroy());
        }
        return sendError(error, reply);
      } finally {
        clearTimeout(timeout);
        request.raw.off('aborted', abort);
      }
    },
  );

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
