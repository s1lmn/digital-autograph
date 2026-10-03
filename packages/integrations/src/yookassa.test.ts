import { randomUUID } from 'node:crypto';
import { it, expect, vi } from 'vitest';
import { fingerprint } from '@digital-autograph/payments';
import { createYookassaProvider, parseYookassaPayment } from './yookassa';
const orderId = randomUUID(),
  id = randomUUID(),
  key = randomUUID();
const input = {
  orderId,
  amountMinor: '123',
  currency: 'RUB' as const,
  returnUrl: 'https://example.test/payments/return',
};
const response = {
  id,
  status: 'pending',
  paid: false,
  test: true,
  metadata: { order_id: orderId },
  recipient: { account_id: '123' },
  amount: { value: '1.23', currency: 'RUB' },
  confirmation: {
    type: 'redirect',
    confirmation_url:
      'https://yoomoney.ru/checkout/payments/v2/contract?orderId=test',
  },
};
function adapter(fetcher: typeof fetch) {
  return createYookassaProvider(
    { shopId: '123', secretKey: 'test_fixture_not_real' },
    { fetch: fetcher },
  );
}
it('uses fixed endpoint, one-stage redirect, exact amount and stable persisted key', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json(response));
  const a = adapter(fetcher);
  await a.createPayment(input, key, fingerprint(input));
  await a.createPayment(input, key, fingerprint(input));
  expect(fetcher.mock.calls[0]![1]?.body).toEqual(
    fetcher.mock.calls[1]![1]?.body,
  );
  expect(fetcher.mock.calls[0]![1]?.headers).toEqual(
    fetcher.mock.calls[1]![1]?.headers,
  );
  const [url, opts] = fetcher.mock.calls[0]!;
  expect(url).toBe('https://api.yookassa.ru/v3/payments');
  expect(opts?.redirect).toBe('error');
  expect(JSON.parse(opts?.body as string)).toEqual({
    amount: { value: '1.23', currency: 'RUB' },
    capture: true,
    confirmation: { type: 'redirect', return_url: input.returnUrl },
    metadata: { order_id: orderId },
  });
  expect((opts?.headers as Record<string, string>)['Idempotence-Key']).toBe(
    key,
  );
});
it('rejects modified payload for persisted key without making a request', async () => {
  const f = vi.fn<typeof fetch>();
  expect(() =>
    adapter(f).createPayment(
      { ...input, amountMinor: '124' },
      key,
      fingerprint(input),
    ),
  ).toThrow('FINGERPRINT');
  expect(f).not.toHaveBeenCalled();
});
it.each([
  'pending',
  'succeeded',
  'canceled',
  'waiting_for_capture',
  'new_status',
])('preserves provider %s', (status) =>
  expect(parseYookassaPayment({ ...response, status }).rawStatus).toBe(status),
);
it.each([
  null,
  {},
  { ...response, test: undefined },
  { ...response, recipient: {} },
  { ...response, amount: { value: '1.239', currency: 'RUB' } },
  { ...response, metadata: {} },
  {
    ...response,
    confirmation: { type: 'redirect', confirmation_url: 'http://evil.test/' },
  },
])('rejects malformed/unsafe object', (value) =>
  expect(() => parseYookassaPayment(value)).toThrow(),
);
it.each([500, 503, 429])('treats HTTP %s as unknown', async (status) => {
  await expect(
    adapter(async () => new Response('sensitive', { status })).getPayment(id),
  ).rejects.toThrow('PROVIDER_OUTCOME_UNKNOWN');
});
it.each([400, 401, 403, 404])('sanitizes HTTP %s', async (status) => {
  await expect(
    adapter(async () => new Response('sensitive', { status })).getPayment(id),
  ).rejects.toThrow('PROVIDER_REJECTED');
});
it('sanitizes timeout errors', async () => {
  await expect(
    adapter(async () => {
      throw new Error('Authorization: sensitive');
    }).getPayment(id),
  ).rejects.toThrow('PROVIDER_OUTCOME_UNKNOWN');
});
it('bounds response bytes', async () => {
  await expect(
    adapter(async () => new Response('x'.repeat(65537))).getPayment(id),
  ).rejects.toThrow('TOO_LARGE');
});
it.each(['http://localhost/', '../payments', 'a?secret=b'])(
  'rejects ID URL injection %s',
  (value) => expect(() => adapter(vi.fn()).getPayment(value)).toThrow(),
);

it('actual HTTP fixture exercises bounded no-redirect transport and request bytes', async () => {
  const { createServer } = await import('node:http');
  const requests: Array<{ method?: string; key?: string; body: string }> = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    requests.push({
      method: req.method,
      key: req.headers['idempotence-key'] as string,
      body,
    });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(response));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as import('node:net').AddressInfo;
    const a = adapter((url, options) => {
      expect(String(url)).toMatch(/^https:\/\/api\.yookassa\.ru\/v3\/payments/);
      return fetch(`http://127.0.0.1:${address.port}`, options);
    });
    await a.createPayment(input, key, fingerprint(input));
    await a.getPayment(id);
    expect(requests[0]).toMatchObject({ method: 'POST', key });
    expect(requests[1]?.method).toBe('GET');
    expect(JSON.parse(requests[0]!.body).amount.value).toBe('1.23');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});
