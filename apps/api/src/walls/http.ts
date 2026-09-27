import {
  createWallBody,
  creatorIdParams,
  creatorSlugParams,
  updateWallBody,
  wallIdParams,
  wallTransitionBody,
} from '@digital-autograph/contracts';
import { WallError, type WallService } from '@digital-autograph/walls';
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

function sendWallError(error: unknown, reply: FastifyReply): unknown {
  if (!(error instanceof WallError)) throw error;
  const status =
    error.code === 'CREATOR_NOT_FOUND' || error.code === 'WALL_NOT_FOUND'
      ? 404
      : error.code === 'FORBIDDEN'
        ? 403
        : error.code === 'WALL_STRUCTURE_LOCKED' ||
            error.code === 'INVALID_WALL_TRANSITION'
          ? 409
          : 400;
  return reply.code(status).send({ error: { code: error.code } });
}

function optionalDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

function ownerView(wall: Awaited<ReturnType<WallService['createWall']>>) {
  return {
    id: wall.id,
    creatorId: wall.creatorId,
    status: wall.status,
    slotCount: wall.slotCount,
    startAt: wall.startAt,
    endAt: wall.endAt,
    slots: wall.slots,
  };
}

export function registerWallRoutes(
  app: FastifyInstance,
  walls: WallService,
): void {
  app.get('/creators/:slug', async (request, reply) => {
    const params = parse(creatorSlugParams, request.params, reply);
    if (!params) return reply;
    try {
      return await walls.getCreator(params.slug);
    } catch (error) {
      return sendWallError(error, reply);
    }
  });

  app.get('/walls/:id', async (request, reply) => {
    const params = parse(wallIdParams, request.params, reply);
    if (!params) return reply;
    try {
      return await walls.getWall(params.id);
    } catch (error) {
      return sendWallError(error, reply);
    }
  });

  app.post(
    '/creators/:creatorId/walls',
    { preHandler: requireAuthenticatedUser },
    async (request, reply) => {
      const params = parse(creatorIdParams, request.params, reply);
      const body = parse(createWallBody, request.body, reply);
      if (!params || !body) return reply;
      try {
        const wall = await walls.createWall(
          authenticatedSession(request).user.id,
          params.creatorId,
          {
            slotCount: body.slotCount,
            startAt: optionalDate(body.startAt),
            endAt: optionalDate(body.endAt),
          },
        );
        return reply.code(201).send(ownerView(wall));
      } catch (error) {
        return sendWallError(error, reply);
      }
    },
  );

  app.patch(
    '/walls/:id',
    { preHandler: requireAuthenticatedUser },
    async (request, reply) => {
      const params = parse(wallIdParams, request.params, reply);
      const body = parse(updateWallBody, request.body, reply);
      if (!params || !body) return reply;
      try {
        const wall = await walls.updateWall(
          authenticatedSession(request).user.id,
          params.id,
          {
            slotCount: body.slotCount,
            ...(body.startAt !== undefined && {
              startAt: optionalDate(body.startAt),
            }),
            ...(body.endAt !== undefined && {
              endAt: optionalDate(body.endAt),
            }),
          },
        );
        return ownerView(wall);
      } catch (error) {
        return sendWallError(error, reply);
      }
    },
  );

  app.post(
    '/walls/:id/transitions',
    { preHandler: requireAuthenticatedUser },
    async (request, reply) => {
      const params = parse(wallIdParams, request.params, reply);
      const body = parse(wallTransitionBody, request.body, reply);
      if (!params || !body) return reply;
      try {
        const wall = await walls.transitionWall(
          authenticatedSession(request).user.id,
          params.id,
          body.action,
        );
        return ownerView(wall);
      } catch (error) {
        return sendWallError(error, reply);
      }
    },
  );
}
