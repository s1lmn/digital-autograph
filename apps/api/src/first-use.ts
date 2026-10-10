import {
  isCurrentLegalState,
  requireLegalDocument,
  LegalError,
} from '@digital-autograph/domain';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { LegalHttp } from './legal-http';
import { authenticatedSession, requireAuthenticatedUser } from './auth/http';
import { z } from 'zod';

declare module 'fastify' {
  interface FastifyContextConfig {
    firstUse?: true;
  }
}
export function firstUseDocuments(legal: LegalHttp) {
  return (['terms_of_use', 'community_guidelines'] as const).map((type) => {
    const d = requireLegalDocument(legal.documents, type);
    const content = legal.documents.find((x) => x === d)!.content;
    if (content.includes('[['))
      throw new LegalError('LEGAL_DOCUMENT_UNAVAILABLE');
    return d;
  });
}
export async function firstUseState(legal: LegalHttp, userId: string) {
  if (!legal.ageDeclarations)
    throw new LegalError('LEGAL_DOCUMENT_UNAVAILABLE');
  const declaredAt = (await legal.ageDeclarations?.declaredAt(userId)) ?? null;
  const documents = firstUseDocuments(legal);
  const requirements = await Promise.all(
    documents.map(async (document) => ({
      type: document.type,
      version: document.version,
      hash: document.hash,
      path: document.path,
      accepted: isCurrentLegalState(
        await legal.repository.latest(userId, document.type),
        document,
      ),
    })),
  );
  return {
    available: !!legal.ageDeclarations,
    adultDeclared: !!declaredAt,
    complete:
      !!legal.ageDeclarations &&
      !!declaredAt &&
      requirements.every((d) => d.accepted),
    documents: requirements,
  };
}
// Route metadata is explicit, not a URL prefix or cookie/localStorage authorization.
export function registerFirstUseEnforcement(
  app: FastifyInstance,
  legal?: LegalHttp,
) {
  const guard: preHandlerHookHandler = async (req, reply) => {
    if (await requireAuthenticatedUser(req, reply)) return reply;
    reply.header('Cache-Control', 'no-store');
    try {
      if (!legal || !legal.ageDeclarations)
        throw new LegalError('LEGAL_DOCUMENT_UNAVAILABLE');
      if (
        !(await firstUseState(legal, authenticatedSession(req).user.id))
          .complete
      )
        return reply.code(409).send({ error: { code: 'FIRST_USE_REQUIRED' } });
    } catch (e) {
      if (e instanceof LegalError)
        return reply.code(409).send({ error: { code: e.code } });
      throw e;
    }
  };
  app.addHook('onRoute', (options) => {
    if (!options.config?.firstUse) return;
    const before = options.preHandler
      ? Array.isArray(options.preHandler)
        ? options.preHandler
        : [options.preHandler]
      : [];
    options.preHandler = [...before, guard];
  });
}
export function registerFirstUseRoutes(app: FastifyInstance, legal: LegalHttp) {
  app.get(
    '/legal/first-use',
    { preHandler: requireAuthenticatedUser },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return await firstUseState(legal, authenticatedSession(req).user.id);
      } catch (e) {
        if (e instanceof LegalError)
          return {
            available: false,
            complete: false,
            adultDeclared: false,
            documents: [],
          };
        throw e;
      }
    },
  );
  app.post(
    '/legal/first-use/age',
    { preHandler: requireAuthenticatedUser, bodyLimit: 1024 },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (
        !z
          .object({ adultDeclared: z.literal(true) })
          .strict()
          .safeParse(req.body).success
      )
        return reply.code(400).send({ error: { code: 'INVALID_REQUEST' } });
      try {
        firstUseDocuments(legal);
        if (!legal.ageDeclarations)
          throw new LegalError('LEGAL_DOCUMENT_UNAVAILABLE');
        return {
          declaredAt: await legal.ageDeclarations.declareAdult(
            authenticatedSession(req).user.id,
          ),
        };
      } catch (e) {
        if (e instanceof LegalError)
          return reply.code(409).send({ error: { code: e.code } });
        throw e;
      }
    },
  );
}
