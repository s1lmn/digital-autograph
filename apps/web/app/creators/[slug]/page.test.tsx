// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import CreatorPage, { generateMetadata } from './page';
vi.mock('@digital-autograph/config', () => ({
  loadWebConfig: () => ({ API_INTERNAL_URL: 'http://internal-api:4000' }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
const props = { params: Promise.resolve({ slug: 'public-creator' }) };
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('uses only the public creator read model and renders public Wall links and metadata', async () => {
  const fetchMock = vi.fn<(input: string) => Promise<Response>>(
    async () =>
      new Response(
        JSON.stringify({
          id: 'creator',
          slug: 'public-creator',
          displayName: 'Public Creator',
          walls: [
            { id: 'public-wall', status: 'live', startAt: null, endAt: null },
          ],
        }),
      ),
  );
  vi.stubGlobal('fetch', fetchMock);
  render(await CreatorPage(props));
  expect(
    screen
      .getByRole('link', { name: 'Public Creator’s Wall' })
      .getAttribute('href'),
  ).toBe('/walls/public-wall');
  expect(fetchMock.mock.calls[0]?.[0]).toBe(
    'http://internal-api:4000/creators/public-creator',
  );
  expect(screen.queryByText('creator')).toBeNull();
  expect(await generateMetadata(props)).toMatchObject({
    title: 'Public Creator — public Walls',
    openGraph: { type: 'website' },
  });
});

it('has an empty state, retry for network failure and a safe 404 for invalid or private creators', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ displayName: 'Creator', walls: [] })),
    ),
  );
  render(await CreatorPage(props));
  expect(
    screen.getByText('No public Walls yet. Check back later.'),
  ).toBeTruthy();
  cleanup();
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce(new Response(null, { status: 404 }));
  vi.stubGlobal('fetch', fetchMock);
  render(await CreatorPage(props));
  expect(
    screen
      .getByRole('link', { name: 'Retry loading creator' })
      .getAttribute('href'),
  ).toBe('/creators/public-creator');
  await expect(CreatorPage(props)).rejects.toThrow('NOT_FOUND');
  await expect(
    CreatorPage({ params: Promise.resolve({ slug: '../private' }) }),
  ).rejects.toThrow('NOT_FOUND');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
