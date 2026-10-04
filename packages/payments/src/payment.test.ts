import { describe, it, expect } from 'vitest';
import {
  minorToDecimal,
  decimalToMinor,
  normalizePaymentStatus,
  canTransition,
  fingerprint,
  bindingFailure,
  type PaymentAttempt,
} from './index';
describe('exact payment money', () => {
  it.each([
    ['1', '0.01'],
    ['100', '1.00'],
    ['12345', '123.45'],
    ['100000000000', '1000000000.00'],
  ])('%s → %s', (minor, decimal) => {
    expect(minorToDecimal(minor)).toBe(decimal);
    expect(decimalToMinor(decimal)).toBe(minor);
  });
  it.each([
    '0',
    '01',
    '-1',
    '1.2',
    '1e3',
    '100000000001',
    '9007199254740993',
    '',
  ])('rejects %s', (value) => expect(() => minorToDecimal(value)).toThrow());
  it.each(['1', '1.001', '01.00', '-1.00', '0.00'])(
    'rejects provider decimal %s',
    (value) => expect(() => decimalToMinor(value)).toThrow(),
  );
});
it.each([
  ['pending', false, 'provider_pending'],
  ['waiting_for_capture', true, 'provider_pending'],
  ['succeeded', true, 'succeeded'],
  ['succeeded', false, 'unknown'],
  ['canceled', false, 'canceled'],
  ['future_status', true, 'unknown'],
])('maps %s safely', (raw, paid, expected) =>
  expect(normalizePaymentStatus(raw as string, paid as boolean)).toBe(expected),
);
it('terminal states cannot regress', () => {
  expect(canTransition('fulfilled', 'provider_pending')).toBe(false);
  expect(canTransition('canceled', 'fulfilled')).toBe(false);
  expect(canTransition('canceled', 'paid_but_not_fulfilled')).toBe(true);
  expect(canTransition('unknown', 'fulfilled')).toBe(true);
});
it('fingerprint covers every immutable request parameter', () => {
  const p = {
    orderId: 'id',
    amountMinor: '123',
    currency: 'RUB' as const,
    returnUrl: 'https://example.test/return',
  };
  expect(fingerprint({ ...p })).toBe(fingerprint(p));
  for (const patch of [
    { orderId: 'other' },
    { amountMinor: '124' },
    { returnUrl: 'https://example.test/other' },
  ])
    expect(fingerprint({ ...p, ...patch })).not.toBe(fingerprint(p));
});
it.each(['orderId', 'shopId', 'amountMinor', 'currency', 'test', 'id'])(
  'verifies %s',
  (key) => {
    const a = {
      orderId: 'o',
      shopId: 's',
      amountMinor: '100',
      currency: 'RUB',
      mode: 'sandbox',
      providerPaymentId: 'p',
    } as PaymentAttempt;
    const seen = {
      id: 'p',
      orderId: 'o',
      shopId: 's',
      amountMinor: '100',
      currency: 'RUB',
      test: true,
      paid: true,
      rawStatus: 'succeeded',
      confirmationUrl: null,
    };
    expect(bindingFailure(a, seen)).toBeNull();
    expect(
      bindingFailure(a, { ...seen, [key]: key === 'test' ? false : 'wrong' }),
    ).not.toBeNull();
  },
);
