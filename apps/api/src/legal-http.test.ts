import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  loadLegalDocuments,
  loadSecurityDocuments,
} from '@digital-autograph/config';
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

it('public catalogues exclude every real draft and do not expose source paths or create evidence', async () => {
  const app = Fastify();
  const record = vi.fn();
  registerLegalRoutes(app, {
    documents: loadLegalDocuments(),
    securityDocuments: loadSecurityDocuments(),
    repository: { latest: vi.fn(), record },
  });
  try {
    for (const url of ['/legal/documents', '/security/documents']) {
      const response = await app.inject(url);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ documents: [] });
      expect(response.headers['cache-control']).toBe('no-store');
    }
    for (const version of ['1.0-destka-20261010', 'unknown'])
      expect(
        (await app.inject(`/security/documents/${version}`)).statusCode,
      ).toBe(404);
    expect(record).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

it('projects only approved identities and retains history when current is unapproved; security is separate', async () => {
  const app = Fastify();
  const doc = loadLegalDocuments()[0]!;
  const security = loadSecurityDocuments()[0]!;
  const oldHash = createHash('sha256')
    .update('Historical fixture\n')
    .digest('hex');
  const securityHash = createHash('sha256')
    .update('Security fixture\n')
    .digest('hex');
  registerLegalRoutes(app, {
    documents: [
      {
        ...doc,
        version: 'old',
        hash: oldHash,
        ready: true,
        current: false,
        content: 'Historical fixture\n',
      },
      {
        ...doc,
        version: 'new',
        ready: false,
        current: true,
        content: 'Unapproved fixture',
      },
      {
        ...doc,
        version: 'incomplete',
        ready: true,
        current: false,
        content: '[[URL]]',
      },
    ],
    securityDocuments: [
      {
        ...security,
        hash: securityHash,
        ready: true,
        content: 'Security fixture\n',
      },
    ],
    repository: { latest: vi.fn(), record: vi.fn() },
  });
  try {
    expect((await app.inject('/legal/documents')).json()).toEqual({
      documents: [
        {
          type: doc.type,
          version: 'old',
          hash: oldHash,
          current: false,
          path: `/legal/documents/${doc.type}/old`,
        },
      ],
    });
    expect((await app.inject(`/legal/documents/${doc.type}/old`)).body).toBe(
      'Historical fixture\n',
    );
    const projected = (await app.inject('/security/documents')).json()
      .documents;
    expect(projected[0]).toEqual({
      type: 'security',
      version: security.version,
      hash: securityHash,
      current: true,
      path: `/security/documents/${security.version}`,
    });
    expect(
      (await app.inject(`/security/documents/${security.version}`)).body,
    ).toBe('Security fixture\n');
    expect(
      (await app.inject(`/legal/documents/security/${security.version}`))
        .statusCode,
    ).toBe(404);
  } finally {
    await app.close();
  }
});
