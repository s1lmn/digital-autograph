import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import {
  getPublications,
  getPublicationText,
  selectPublication,
  versionPath,
  documentRoutes,
  type Publication,
} from './legal-publications';
const text = 'Синтетический текст\n1. Не юридический документ.\n';
const doc: Publication = {
  type: 'terms_of_use',
  version: 'fixture-v1',
  current: false,
  hash: createHash('sha256').update(text).digest('hex'),
  path: '/legal/documents/terms_of_use/fixture-v1',
};
afterEach(() => vi.unstubAllGlobals());
it('reads only published projections without cookies or caching', async () => {
  const fetch = vi.fn().mockImplementation(
    async (url: string) =>
      new Response(
        JSON.stringify({
          documents: url.includes('/security/') ? [] : [doc],
        }),
      ),
  );
  vi.stubGlobal('fetch', fetch);
  expect(await getPublications('http://127.0.0.1:4000')).toEqual([doc]);
  expect(fetch).toHaveBeenCalledWith(
    'http://127.0.0.1:4000/legal/documents',
    expect.objectContaining({
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    }),
  );
  expect(selectPublication([doc], 'terms_of_use', 'fixture-v1')).toEqual(doc);
  expect(versionPath(doc)).toBe('/legal/terms/versions/fixture-v1');
  expect(() => selectPublication([doc], 'terms_of_use')).toThrow();
  expect(() => selectPublication([doc], 'terms_of_use', 'unknown')).toThrow();
  expect(() =>
    selectPublication([doc], 'terms_of_use', '../internal'),
  ).toThrow();
});
it.each([
  {},
  { documents: [{ ...doc, path: 'https://evil.test' }] },
  { documents: [{ ...doc, type: 'privacy_data_map' }] },
  { documents: [doc, doc] },
  { documents: [{ ...doc, version: '../internal' }] },
])('fails closed on invalid/untrusted projection %j', async (value) => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify(value))),
  );
  await expect(getPublications('http://127.0.0.1:4000')).rejects.toThrow(
    'Public document unavailable',
  );
});
it('never falls back when the backend is unavailable', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
  await expect(getPublications('http://127.0.0.1:4000')).rejects.toThrow();
});
it('reads exact historical bytes with published marker and matching hash', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(text, {
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'x-legal-document-status': 'published',
        },
      }),
    ),
  );
  expect(await getPublicationText('http://127.0.0.1:4000', doc)).toBe(text);
});
it.each(['tampered', '[[URL]]', '<html>error</html>'])(
  'rejects unexpected content %s',
  async (value) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(value, {
          headers: {
            'content-type': 'text/plain',
            'x-legal-document-status': 'published',
          },
        }),
      ),
    );
    await expect(
      getPublicationText('http://127.0.0.1:4000', doc),
    ).rejects.toThrow();
  },
);
it('does not treat a missing published header as approval', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(text, { headers: { 'content-type': 'text/plain' } }),
      ),
  );
  await expect(
    getPublicationText('http://127.0.0.1:4000', doc),
  ).rejects.toThrow();
});
it('maps all seven legal types and the separate security contract', () => {
  expect(documentRoutes.map((d) => d.slug)).toEqual([
    'terms',
    'content-rules',
    'offer',
    'refunds',
    'privacy',
    'personal-data-consent',
    'dissemination-consent',
    'security',
  ]);
});
