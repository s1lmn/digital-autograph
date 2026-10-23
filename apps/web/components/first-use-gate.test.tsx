// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { FirstUseGate } from './first-use-gate';
it('renders the existing editor only on explicit server-disabled enforcement without pretending consent is complete', async () => {
  const ready = vi.fn();
  const fetch = vi.fn(async () =>
    json({
      enforced: false,
      available: false,
      complete: false,
      adultDeclared: false,
      documents: [],
    }),
  );
  vi.stubGlobal('fetch', fetch);
  render(
    <FirstUseGate apiOrigin="http://api.test" onReady={ready}>
      <p>Existing editor</p>
    </FirstUseGate>,
  );
  await screen.findByText('Existing editor');
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(fetch).toHaveBeenCalledOnce();
  await waitFor(() => expect(ready).toHaveBeenCalledOnce());
});
const docs = ['terms_of_use', 'community_guidelines'].map((type) => ({
  type,
  version: 'test-v1',
  hash: 'a'.repeat(64),
  path: `/legal/documents/${type}/test-v1`,
  accepted: false,
}));
const initial = {
  available: true,
  complete: false,
  adultDeclared: false,
  documents: docs,
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('requires three unselected choices, exact version links and server confirmation; double submit is bounded', async () => {
  let confirmed = false;
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (!options?.method)
      return json(
        confirmed
          ? {
              ...initial,
              complete: true,
              adultDeclared: true,
              documents: docs.map((d) => ({ ...d, accepted: true })),
            }
          : initial,
      );
    if (
      url.endsWith('/legal/accept') &&
      JSON.parse(options.body as string).type === 'community_guidelines'
    )
      confirmed = true;
    return json({});
  });
  vi.stubGlobal('fetch', fetch);
  render(
    <FirstUseGate apiOrigin="http://api.test">
      <p>Protected editor</p>
    </FirstUseGate>,
  );
  const checkboxes = await screen.findAllByRole('checkbox');
  expect(checkboxes).toHaveLength(3);
  for (const c of checkboxes)
    expect((c as HTMLInputElement).checked).toBe(false);
  expect(screen.queryByText('Protected editor')).toBeNull();
  const button = screen.getByRole('button', { name: 'Продолжить' });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(
    screen
      .getByRole('link', { name: /Пользовательское соглашение —/ })
      .getAttribute('href'),
  ).toBe('/legal/terms/versions/test-v1');
  fireEvent.click(checkboxes[0]!);
  fireEvent.click(checkboxes[1]!);
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(checkboxes[2]!);
  fireEvent.click(button);
  fireEvent.click(button);
  await screen.findByText('Protected editor');
  expect(fetch.mock.calls.filter(([, o]) => o?.method === 'POST')).toHaveLength(
    3,
  );
  expect(fetch).toHaveBeenCalledWith(
    'http://api.test/legal/first-use/age',
    expect.objectContaining({
      credentials: 'include',
      body: '{"adultDeclared":true}',
    }),
  );
});
it('unapproved documents offer no acceptance or draft links and retain account access', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      json({
        available: false,
        complete: false,
        adultDeclared: false,
        documents: [],
      }),
    ),
  );
  render(
    <FirstUseGate apiOrigin="http://api.test">
      <p>Protected editor</p>
    </FirstUseGate>,
  );
  await screen.findByText(/действующие документы ещё не опубликованы/);
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Продолжить' })).toBeNull();
  expect(
    screen.getByRole('link', { name: 'Аккаунт и выход' }).getAttribute('href'),
  ).toBe('/me');
});
it('stale response resets unseen choices, refreshes identity and focuses the error heading', async () => {
  let reads = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, o?: RequestInit) =>
      o?.method
        ? json({ error: { code: 'LEGAL_DOCUMENT_CHANGED' } }, 409)
        : json(
            reads++
              ? {
                  ...initial,
                  documents: docs.map((d) => ({
                    ...d,
                    version: 'test-v2',
                    path: `/legal/documents/${d.type}/test-v2`,
                  })),
                }
              : initial,
          ),
    ),
  );
  render(
    <FirstUseGate apiOrigin="http://api.test">
      <p>Protected editor</p>
    </FirstUseGate>,
  );
  for (const c of await screen.findAllByRole('checkbox')) fireEvent.click(c);
  fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
  await screen.findByText(/Редакция документа изменилась/);
  await screen.findByRole('link', {
    name: /Пользовательское соглашение — редакция test-v2/,
  });
  for (const c of screen.getAllByRole('checkbox'))
    expect((c as HTMLInputElement).checked).toBe(false);
  expect(document.activeElement).toBe(
    screen.getByRole('heading', { name: 'Перед первым действием' }),
  );
  expect(screen.queryByText('Protected editor')).toBeNull();
});
it('partial failure rechecks evidence but never unlocks on a successful single POST', async () => {
  let posts = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_u: string, o?: RequestInit) =>
      o?.method ? json({}, ++posts === 2 ? 503 : 200) : json(initial),
    ),
  );
  render(
    <FirstUseGate apiOrigin="http://api.test">
      <p>Protected editor</p>
    </FirstUseGate>,
  );
  for (const c of await screen.findAllByRole('checkbox')) fireEvent.click(c);
  fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
  await screen.findByText(/Подтверждение не завершено/);
  expect(screen.queryByText('Protected editor')).toBeNull();
});
it('malformed/untrusted metadata fails closed and network retry preserves server authority', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      json({
        ...initial,
        documents: docs.map((d) => ({ ...d, path: 'https://evil.test' })),
      }),
    )
    .mockResolvedValueOnce(json(initial));
  vi.stubGlobal('fetch', fetch);
  render(
    <FirstUseGate apiOrigin="http://api.test">
      <p>Protected editor</p>
    </FirstUseGate>,
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Повторить проверку' }),
  );
  await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(3));
  expect(screen.queryByText('Protected editor')).toBeNull();
});
