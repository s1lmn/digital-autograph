import { z } from 'zod';
import {
  LegalError,
  isCurrentLegalState,
  type LegalDocument,
  type LegalRepository,
} from '@digital-autograph/domain';
import type { FastifyInstance } from 'fastify';
import { authenticatedSession, requireAuthenticatedUser } from './auth/http';
const types = z.enum([
  'terms_of_use',
  'community_guidelines',
  'public_offer',
  'refund_policy',
  'privacy_policy',
  'personal_data_consent',
  'personal_data_dissemination_consent',
]);
export type LegalHttp = {
  repository: LegalRepository;
  documents: readonly (LegalDocument & { content: string })[];
};
export function registerLegalRoutes(app: FastifyInstance, legal: LegalHttp) {
  app.get('/legal/documents/:type/:version', async (req, reply) => {
    const params = z
      .object({ type: types, version: z.string().max(64) })
      .safeParse(req.params);
    const doc = params.success
      ? legal.documents.find(
          (d) =>
            d.type === params.data.type && d.version === params.data.version,
        )
      : undefined;
    if (!doc)
      return reply
        .code(404)
        .send({ error: { code: 'LEGAL_DOCUMENT_NOT_FOUND' } });
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Legal-Document-Status', doc.ready ? 'published' : 'draft');
    return reply.type('text/plain; charset=utf-8').send(doc.content);
  });
  app.get(
    '/legal/state/:type',
    { preHandler: requireAuthenticatedUser },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      const params = z.object({ type: types }).safeParse(req.params);
      const query = z
        .object({
          purpose: z
            .enum([
              'optional_profile',
              'optional_support',
              'optional_notifications',
            ])
            .optional(),
        })
        .strict()
        .safeParse(req.query);
      if (!params.success || !query.success)
        return reply.code(400).send({ error: { code: 'INVALID_REQUEST' } });
      const document = legal.documents.find(
        (d) => d.type === params.data.type && d.current,
      )!;
      const latest = await legal.repository.latest(
        authenticatedSession(req).user.id,
        params.data.type,
        query.data.purpose,
      );
      return {
        document: {
          type: document.type,
          version: document.version,
          hash: document.hash,
          path: document.path,
          ready: document.ready,
        },
        latest,
        current: isCurrentLegalState(latest, document),
      };
    },
  );
  app.post(
    '/legal/accept',
    { preHandler: requireAuthenticatedUser, bodyLimit: 1024 },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      const body = z
        .object({ type: z.enum(['terms_of_use', 'community_guidelines']) })
        .strict()
        .safeParse(req.body);
      if (!body.success)
        return reply.code(400).send({ error: { code: 'INVALID_REQUEST' } });
      const document = legal.documents.find(
        (d) => d.type === body.data.type && d.current,
      )!;
      try {
        return {
          event: await legal.repository.record(
            authenticatedSession(req).user.id,
            document,
            'accepted',
            'web',
            'legal_gate',
          ),
        };
      } catch (e) {
        if (e instanceof LegalError)
          return reply.code(409).send({ error: { code: e.code } });
        throw e;
      }
    },
  );
  app.post(
    '/legal/withdraw',
    { preHandler: requireAuthenticatedUser, bodyLimit: 1024 },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      const body = z
        .object({
          type: z.literal('personal_data_consent'),
          purpose: z.enum([
            'optional_profile',
            'optional_support',
            'optional_notifications',
          ]),
        })
        .strict()
        .safeParse(req.body);
      if (!body.success)
        return reply.code(400).send({ error: { code: 'INVALID_REQUEST' } });
      const userId = authenticatedSession(req).user.id;
      const prior = await legal.repository.latest(
        userId,
        body.data.type,
        body.data.purpose,
      );
      if (!prior?.scope) return { event: null };
      const document = legal.documents.find(
        (d) => d.type === body.data.type && d.current,
      )!;
      return {
        event: await legal.repository.record(
          userId,
          document,
          'withdrawn',
          'web',
          'privacy_settings',
          prior.scope,
        ),
      };
    },
  );
}
