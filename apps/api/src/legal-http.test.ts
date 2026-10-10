import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { loadLegalDocuments } from '@digital-autograph/config';
import { registerLegalRoutes } from './legal-http';

describe('public legal publication boundary', () => {
  it('hides every real current/historical draft and internal type from all visitors', async () => {
    const app = Fastify();
    const documents = loadLegalDocuments();
    registerLegalRoutes(app, {
      documents,
      repository: { latest: vi.fn(), record: vi.fn() },
    });
    try {
      for (const url of [
        ...documents.map((d) => d.path),
        '/legal/documents/privacy_data_map/1.0',
        '/legal/documents/consent_ux_spec/1.0',
        '/legal/documents/terms_of_use/unknown',
      ]) {
        for (const headers of [
          {},
          {
            cookie: 'da_session=fixture',
            'x-legal-document-status': 'published',
          },
        ]) {
          const response = await app.inject({
            url: `${url}?ready=true&preview=true`,
            headers,
          });
          expect(response.statusCode).toBe(404);
          expect(response.json()).toEqual({
            error: { code: 'LEGAL_DOCUMENT_NOT_FOUND' },
          });
          expect(response.headers['cache-control']).toBe('no-store');
          expect(response.headers['x-legal-document-status']).toBeUndefined();
          expect(response.body).not.toContain('[[URL');
          expect(response.body).not.toContain('Лошкарев');
        }
      }
    } finally {
      await app.close();
    }
  });

  it('serves published historical bytes after a new current version, but rejects placeholders even if mis-marked ready', async () => {
    const app = Fastify();
    const source = loadLegalDocuments().find((d) => d.current)!;
    registerLegalRoutes(app, {
      repository: { latest: vi.fn(), record: vi.fn() },
      documents: [
        {
          ...source,
          version: 'published-v0',
          current: false,
          ready: true,
          content: 'Published historical fixture\n',
        },
        {
          ...source,
          version: 'published-v1',
          current: true,
          ready: true,
          content: 'Published current fixture\n',
        },
        {
          ...source,
          version: 'incomplete',
          ready: true,
          content: 'draft [[URL]]',
        },
      ],
    });
    try {
      for (const [version, text] of [
        ['published-v0', 'Published historical fixture\n'],
        ['published-v1', 'Published current fixture\n'],
      ]) {
        const response = await app.inject(
          `/legal/documents/${source.type}/${version}`,
        );
        expect(response.statusCode).toBe(200);
        expect(response.body).toBe(text);
        expect(response.headers['x-legal-document-status']).toBe('published');
      }
      expect(
        (await app.inject(`/legal/documents/${source.type}/incomplete`))
          .statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });
});
