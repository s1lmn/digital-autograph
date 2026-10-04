import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  notificationPreferencesBody,
  notificationIdParams,
  notificationFollowBody,
} from '@digital-autograph/contracts';
import {
  NotificationError,
  type NotificationService,
} from '@digital-autograph/notifications';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticatedSession, requireAuthenticatedUser } from '../auth/http';

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const updateSchema = z.object({
  message: z.object({
    text: z.string().max(256),
    from: z.object({
      id: z.number().int().positive(),
      is_bot: z.literal(false),
    }),
    chat: z.object({
      id: z.number().int().positive(),
      type: z.literal('private'),
    }),
  }),
});
export function registerNotificationRoutes(
  app: FastifyInstance,
  service: NotificationService,
  telegram?: { username: string; secret: string },
) {
  app.register(async (app) => {
    app.setErrorHandler((error, request, reply) => {
      // Notification errors are sanitized; other routes keep Fastify's default behavior.
      if (error instanceof NotificationError)
        return reply
          .code(
            error.code === 'NOT_FOUND'
              ? 404
              : error.code === 'RATE_LIMITED'
                ? 429
                : 400,
          )
          .send({ error: { code: error.code } });
      const code =
        error instanceof z.ZodError
          ? 400
          : error instanceof Error &&
              'statusCode' in error &&
              typeof error.statusCode === 'number'
            ? error.statusCode
            : 500;
      if (code >= 500)
        request.log.error({ code: 'REQUEST_FAILURE' }, 'Request failed');
      return reply.code(code).send({
        error: { code: code === 400 ? 'INVALID_REQUEST' : 'REQUEST_FAILURE' },
      });
    });
    const protectedRoute = { preHandler: requireAuthenticatedUser };
    app.addHook('onSend', async (request, reply, payload) => {
      if (request.url.startsWith('/me/notifications'))
        reply.header('Cache-Control', 'no-store');
      return payload;
    });
    app.get('/me/notifications', protectedRoute, (request) =>
      service.inbox(authenticatedSession(request).user.id),
    );
    app.get(
      '/me/notifications/preferences',
      protectedRoute,
      async (request) => ({
        ...(await service.repository.preferences(
          authenticatedSession(request).user.id,
        )),
        telegramAvailable: !!telegram,
      }),
    );
    app.put('/me/notifications/preferences', protectedRoute, (request) =>
      service.repository.updatePreferences(
        authenticatedSession(request).user.id,
        notificationPreferencesBody.parse(request.body),
      ),
    );
    app.post(
      '/me/notifications/:id/read',
      protectedRoute,
      async (request, reply) => {
        await service.repository.read(
          authenticatedSession(request).user.id,
          notificationIdParams.parse(request.params).id,
        );
        return reply.code(204).send();
      },
    );
    app.put(
      '/me/notifications/walls/:id',
      protectedRoute,
      async (request, reply) => {
        await service.repository.follow(
          authenticatedSession(request).user.id,
          notificationIdParams.parse(request.params).id,
          notificationFollowBody.parse(request.body).enabled,
        );
        return reply.code(204).send();
      },
    );
    app.delete(
      '/me/notifications/telegram',
      protectedRoute,
      async (request, reply) => {
        await service.repository.disconnect(
          authenticatedSession(request).user.id,
        );
        return reply.code(204).send();
      },
    );
    if (!telegram) return;
    app.post(
      '/me/notifications/telegram/link',
      protectedRoute,
      async (request) => {
        const token = randomBytes(32).toString('base64url');
        await service.repository.issueLink(
          authenticatedSession(request).user.id,
          hash(token),
        );
        return {
          url: `https://t.me/${telegram.username}?start=${token}`,
          expiresInSeconds: 600,
        };
      },
    );
    app.post(
      '/notifications/telegram/webhook',
      { bodyLimit: 16384 },
      async (request, reply) => {
        const header = request.headers['x-telegram-bot-api-secret-token'];
        if (
          typeof header !== 'string' ||
          Buffer.byteLength(header) !== Buffer.byteLength(telegram.secret) ||
          !timingSafeEqual(Buffer.from(header), Buffer.from(telegram.secret))
        )
          return reply.code(403).send({ error: { code: 'FORBIDDEN' } });
        const parsed = updateSchema.safeParse(request.body);
        if (!parsed.success) return { ok: true };
        const message = parsed.data.message;
        if (
          !Number.isSafeInteger(message.chat.id) ||
          message.chat.id !== message.from.id
        )
          return { ok: true };
        const chat = String(message.chat.id);
        if (message.text === '/stop') await service.repository.stopChat(chat);
        else if (/^\/start [A-Za-z0-9_-]{43}$/.test(message.text)) {
          try {
            await service.repository.acceptLink(
              hash(message.text.slice(7)),
              chat,
            );
          } catch (error) {
            if (
              !(error instanceof NotificationError) &&
              !(
                error instanceof Error &&
                'code' in error &&
                error.code === '23505'
              )
            )
              throw error;
          }
        }
        return { ok: true };
      },
    );
  });
}
