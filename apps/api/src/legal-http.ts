import { z } from 'zod';
import {
  LegalError,
  isCurrentLegalState,
  type LegalDocument,
  type LegalRepository,
} from '@digital-autograph/domain';
import type { SecurityDocument } from '@digital-autograph/config';
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
  securityDocuments?: readonly SecurityDocument[];
};
function isPublished(doc: { ready: boolean; content: string }) {
  return doc.ready && !doc.content.includes('[[');
}
export function registerLegalRoutes(app: FastifyInstance, legal: LegalHttp) {
  app.get('/legal/documents', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return {
      documents: legal.documents
        .filter(isPublished)
        .map(({ type, version, hash, current }) => ({
          type,
          version,
          hash,
          current,
          path: `/legal/documents/${type}/${version}`,
        })),
    };
  });
  app.get('/security/documents', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return {
      documents: (legal.securityDocuments ?? [])
        .filter(isPublished)
        .map(({ version, hash, current }) => ({
          type: 'security',
          version,
          hash,
          current,
          path: `/security/documents/${version}`,
        })),
    };
  });
  app.get('/security/documents/:version', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const params = z
      .object({ version: z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/) })
      .safeParse(req.params);
    const doc = params.success
      ? legal.securityDocuments?.find((d) => d.version === params.data.version)
      : undefined;
    if (!doc || !isPublished(doc))
      return reply
        .code(404)
        .send({ error: { code: 'LEGAL_DOCUMENT_NOT_FOUND' } });
    reply.header('X-Legal-Document-Status', 'published');
    return reply.type('text/plain; charset=utf-8').send(doc.content);
  });
  app.get('/legal/documents/:type/:version', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const params = z
      .object({ type: types, version: z.string().max(64) })
      .safeParse(req.params);
    const doc = params.success
      ? legal.documents.find(
          (d) =>
            d.type === params.data.type && d.version === params.data.version,
        )
      : undefined;
    // Public reads never disclose drafts, including to signed-in users.
    // Use the same response for unknown and unapproved versions.
    if (!doc || !isPublished(doc))
      return reply
        .code(404)
        .send({ error: { code: 'LEGAL_DOCUMENT_NOT_FOUND' } });
    reply.header('X-Legal-Document-Status', 'published');
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
        .object({
          type: z.enum(['terms_of_use', 'community_guidelines']),
          version: z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/),
          hash: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict()
        .safeParse(req.body);
      if (!body.success)
        return reply.code(400).send({ error: { code: 'INVALID_REQUEST' } });
      const document = legal.documents.find(
        (d) => d.type === body.data.type && d.current,
      )!;
      // Displayed identity is a precondition, never authoritative evidence.
      // A deployment between display and acceptance must not record new wording
      // that the subject never saw. Persist only the server registry document.
      if (
        body.data.version !== document.version ||
        body.data.hash !== document.hash
      )
        return reply
          .code(409)
          .send({ error: { code: 'LEGAL_DOCUMENT_CHANGED' } });
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
