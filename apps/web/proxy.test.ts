import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';
vi.mock('@digital-autograph/config', () => ({
  loadWebConfig: () => ({ API_INTERNAL_URL: 'http://127.0.0.1:4000' }),
}));
afterEach(() => vi.unstubAllGlobals());
const request = (path: string) =>
  new NextRequest(`https://example.test${path}`);
it('returns real 404 before streaming for drafts, independent of cookies/query hints', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => new Response('{"documents":[]}')),
  );
  for (const path of [
    '/legal/terms?ready=true',
    '/legal/terms/versions/unapproved',
    '/legal/terms/archive',
    '/security',
    '/security/versions/unapproved',
    '/security/archive',
  ]) {
    const response = await proxy(request(path));
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(await response.text()).toContain('Документ не найден');
  }
});
it('returns safe 503 without reflecting network errors', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('PRIVATE ERROR')));
  const response = await proxy(request('/legal/terms'));
  expect(response.status).toBe(503);
  const html = await response.text();
  expect(html).toContain('Документы временно недоступны');
  expect(html).not.toContain('PRIVATE ERROR');
});
it('allows exact approved history and its archive while rejecting the absent current', async () => {
  const doc = {
    type: 'terms_of_use',
    version: 'historical',
    current: false,
    hash: 'a'.repeat(64),
    path: '/legal/documents/terms_of_use/historical',
  };
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(
      async (url: string) =>
        new Response(
          JSON.stringify({
            documents: url.includes('/security/') ? [] : [doc],
          }),
        ),
    ),
  );
  for (const path of [
    '/legal/terms/versions/historical',
    '/legal/terms/archive',
  ])
    expect((await proxy(request(path))).headers.get('x-middleware-next')).toBe(
      '1',
    );
  expect((await proxy(request('/legal/terms'))).status).toBe(404);
  expect((await proxy(request('/legal/terms/versions/unknown'))).status).toBe(
    404,
  );
});
it('rejects internal/extra path segments without API reads', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  for (const path of [
    '/legal/privacy_data_map',
    '/legal/terms/extra',
    '/security/internal',
  ])
    expect((await proxy(request(path))).status).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
  expect(
    (await proxy(request('/legal'))).headers.get('x-middleware-next'),
  ).toBe('1');
});
