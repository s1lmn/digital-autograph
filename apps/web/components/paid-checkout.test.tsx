// @vitest-environment jsdom
import { webcrypto, createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { PaidCheckout } from './paid-checkout';
import { LocaleProvider } from './locale-provider';
const id = '11111111-1111-4111-8111-111111111111';
const types = ['public_offer', 'community_guidelines', 'refund_policy'];
const summary = {
  reservationId: id,
  autographId: id,
  wallId: id,
  wallTitle: 'Тестовый стенд',
  creatorName: 'Тестовый создатель',
  slotId: id,
  slotNumber: 3,
  amountMinor: '65000',
  currency: 'RUB',
  guaranteedVisibilitySeconds: 60,
  reservationExpiresAt: '2099-01-01T00:00:00.000Z',
  targetPlacementId: id,
  pricingConfigId: id,
  documents: types.map((type) => ({
    type,
    version: 'test-v1',
    hash: createHash('sha256').update(`fixture ${type}`).digest('hex'),
  })),
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
function fixture({
  failure = '',
  postUrl = 'https://yoomoney.ru/payments/external/confirmation?test=1',
  changed = false,
  summaryPatch = {} as Partial<typeof summary>,
  locale = undefined as 'ru' | 'en' | undefined,
} = {}) {
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes('/payments/checkout'))
      return failure
        ? json({ error: { code: failure } }, 409)
        : json({ ...summary, ...summaryPatch });
    if (url.includes('/legal/documents/')) {
      const type = url.split('/').at(-2)!;
      return new Response(`fixture ${type}`, {
        headers: {
          'Content-Type': 'text/plain',
          'X-Legal-Document-Status': 'published',
        },
      });
    }
    if (url.endsWith('/preview'))
      return json({
        assetId: id,
        url: 'https://private.example.test/cleaned.png',
        expiresAt: '2099-01-01T00:00:00Z',
      });
    if (options?.method === 'POST')
      return changed
        ? json({ error: { code: 'CHECKOUT_TERMS_CHANGED' } }, 409)
        : json({ id, status: 'provider_pending', confirmationUrl: postUrl });
    return json({});
  });
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('crypto', webcrypto);
  const checkout = (
    <PaidCheckout
      apiOrigin="http://api.test"
      reservationId={id}
      autographId={id}
    />
  );
  render(
    locale ? (
      <LocaleProvider initialLocale={locale}>{checkout}</LocaleProvider>
    ) : (
      checkout
    ),
  );
  return fetch;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('shows backend terms and exact three editions; checkbox and private preview are required; double submit is bounded', async () => {
  const fetch = fixture();
  const checkbox = await screen.findByRole('checkbox');
  const button = screen.getByRole('button', {
    name: 'Подтвердить заказ и перейти к оплате',
  });
  expect((checkbox as HTMLInputElement).checked).toBe(false);
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('Тестовый создатель')).toBeTruthy();
  expect(screen.getByText('№ 3')).toBeTruthy();
  expect(screen.getByText('60 секунд')).toBeTruthy();
  for (const slug of ['offer', 'content-rules', 'refunds'])
    expect(
      screen
        .getAllByRole('link')
        .some(
          (a) => a.getAttribute('href') === `/legal/${slug}/versions/test-v1`,
        ),
    ).toBe(true);
  fireEvent.click(checkbox);
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.load(screen.getByRole('img'));
  fireEvent.submit(button.closest('form')!);
  fireEvent.submit(button.closest('form')!);
  await screen.findByRole('link', { name: 'Перейти к оплате в ЮKassa' });
  const posts = fetch.mock.calls.filter(
    ([, options]) => options?.method === 'POST',
  );
  expect(posts).toHaveLength(1);
  const body = JSON.parse(posts[0]![1]!.body as string);
  expect(body.confirmation.confirmed).toBe(true);
  expect(body.confirmation.documents).toEqual(summary.documents);
  expect(body.confirmation.terms.amountMinor).toBe('65000');
});
it('restores the existing pending payment link on reload and repeated checks without a new order', async () => {
  const confirmationUrl =
    'https://yoomoney.ru/payments/external/confirmation?test=existing';
  const fetch = vi.fn(async (url: string) =>
    url.includes('/payments/checkout')
      ? json({ existingOrderId: id })
      : json({ id, status: 'provider_pending', confirmationUrl }),
  );
  vi.stubGlobal('fetch', fetch);
  render(
    <PaidCheckout
      apiOrigin="http://api.test"
      reservationId={id}
      autographId={id}
    />,
  );
  expect(
    (
      await screen.findByRole('link', { name: 'Перейти к оплате в ЮKassa' })
    ).getAttribute('href'),
  ).toBe(confirmationUrl);
  fireEvent.click(
    screen.getByRole('button', { name: 'Повторить проверку условий' }),
  );
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
  expect(
    (
      await screen.findByRole('link', { name: 'Перейти к оплате в ЮKassa' })
    ).getAttribute('href'),
  ).toBe(confirmationUrl);
  expect(screen.queryByRole('checkbox')).toBeNull();
  for (const [, options] of fetch.mock.calls as unknown as Array<
    [string, RequestInit]
  >) {
    expect(options.method).toBeUndefined();
    expect(options.credentials).toBe('include');
    expect(options.cache).toBe('no-store');
  }
});
it.each([
  ['provider_pending', 'https://yoomoney.ru.evil.example/pay'],
  ['provider_pending', 'javascript:alert(1)'],
  ['provider_pending', null],
  ['fulfilled', 'https://yoomoney.ru/payments/external/confirmation?test=old'],
])(
  'does not restore an unsafe or terminal payment link: %s %s',
  async (status, confirmationUrl) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/payments/checkout')
          ? json({ existingOrderId: id })
          : json({ id, status, confirmationUrl }),
      ),
    );
    render(
      <PaidCheckout
        apiOrigin="http://api.test"
        reservationId={id}
        autographId={id}
      />,
    );
    await screen.findByRole('link', { name: 'Проверить состояние заказа' });
    expect(
      screen.queryByRole('link', { name: 'Перейти к оплате в ЮKassa' }),
    ).toBeNull();
  },
);
it.each([
  'LEGAL_DOCUMENT_UNAVAILABLE',
  'NEW_PAYMENTS_DISABLED',
  'RESERVATION_EXPIRED',
])('fails closed on %s and offers no payment checkbox', async (failure) => {
  fixture({ failure });
  await screen.findByRole('alert');
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(
    screen.queryByRole('link', { name: 'Перейти к оплате в ЮKassa' }),
  ).toBeNull();
});
it('stale conditions discard the old choice and focus the error; malicious provider URL is never offered', async () => {
  fixture({ changed: true });
  const checkbox = await screen.findByRole('checkbox');
  fireEvent.load(screen.getByRole('img'));
  fireEvent.click(checkbox);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Подтвердить заказ и перейти к оплате',
    }),
  );
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Условия заказа изменились',
  );
  expect(screen.queryByRole('checkbox')).toBeNull();
  await waitFor(() =>
    expect(document.activeElement?.id).toBe('checkout-heading'),
  );
  cleanup();
  fixture({ postUrl: 'https://yoomoney.ru.evil.example/pay' });
  fireEvent.click(await screen.findByRole('checkbox'));
  fireEvent.load(screen.getByRole('img'));
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Подтвердить заказ и перейти к оплате',
    }),
  );
  await screen.findByRole('link', { name: 'Проверить состояние заказа' });
  expect(
    screen.queryByRole('link', { name: 'Перейти к оплате в ЮKassa' }),
  ).toBeNull();
});
it('document body/hash mismatch prevents submission even if metadata says published', async () => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.includes('/payments/checkout')
        ? json(summary)
        : new Response('tampered', {
            headers: {
              'Content-Type': 'text/plain',
              'X-Legal-Document-Status': 'published',
            },
          }),
    ),
  );
  render(
    <PaidCheckout
      apiOrigin="http://api.test"
      reservationId={id}
      autographId={id}
    />,
  );
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Документы временно недоступны',
  );
  expect(screen.queryByRole('checkbox')).toBeNull();
});

it.each(['ru', 'en'] as const)(
  'renders approved server prices and 900-second protection in %s',
  async (locale) => {
    for (const amountMinor of ['8900', '18900', '498900']) {
      fixture({
        locale,
        summaryPatch: { amountMinor, guaranteedVisibilitySeconds: 900 },
      });
      await screen.findByRole('checkbox');
      const expected = new Intl.NumberFormat(
        locale === 'ru' ? 'ru-RU' : 'en-US',
        { style: 'currency', currency: 'RUB' },
      ).format(Number(amountMinor) / 100);
      expect(
        screen
          .getAllByRole('definition')
          .some((node) => node.textContent === expected),
      ).toBe(true);
      expect(
        screen.getByText(locale === 'ru' ? '900 секунд' : '900 seconds'),
      ).toBeTruthy();
      cleanup();
    }
  },
);
