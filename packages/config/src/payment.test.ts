import { it, expect } from 'vitest';
import { loadPaymentConfig } from './index';
const fixture = {
  APP_ENV: 'test',
  PAYMENT_PROVIDER: 'yookassa',
  PAYMENT_MODE: 'sandbox',
  YOOKASSA_SHOP_ID: '123',
  YOOKASSA_SECRET_KEY: 'test_fixture_not_real',
  WEB_ORIGIN: 'http://127.0.0.1:3000',
  PAYMENT_RETURN_URL: 'http://127.0.0.1:3000/payments/return',
  PAYMENT_CREATOR_SHARE_BPS: '5000',
};
it('disabled without configuration, explicit complete sandbox config otherwise', () => {
  expect(loadPaymentConfig({})).toBeNull();
  expect(loadPaymentConfig(fixture)?.PAYMENT_MODE).toBe('sandbox');
});
it.each(Object.keys(fixture))('rejects missing %s', (key) => {
  const env: { [key: string]: string } = { ...fixture };
  delete env[key];
  expect(() => loadPaymentConfig(env)).toThrow();
});
it.each(['local', 'test', 'development', 'staging'])(
  'never activates live in %s',
  (APP_ENV) =>
    expect(() =>
      loadPaymentConfig({
        ...fixture,
        APP_ENV,
        PAYMENT_MODE: 'live',
        PAYMENT_LIVE_ACTIVATION: 'approved',
      }),
    ).toThrow(),
);
it('live requires explicit production activation', () => {
  const env = {
    ...fixture,
    APP_ENV: 'production',
    PAYMENT_MODE: 'live',
    WEB_ORIGIN: 'https://example.test',
    PAYMENT_RETURN_URL: 'https://example.test/payments/return',
  };
  expect(() => loadPaymentConfig(env)).toThrow();
  expect(
    loadPaymentConfig({ ...env, PAYMENT_LIVE_ACTIVATION: 'approved' })
      ?.PAYMENT_MODE,
  ).toBe('live');
});
it.each([
  'https://evil.test',
  'http://127.0.0.1:3000/return?x=y',
  'http://user:pass@127.0.0.1:3000/return',
])('rejects unsafe return %s', (PAYMENT_RETURN_URL) =>
  expect(() => loadPaymentConfig({ ...fixture, PAYMENT_RETURN_URL })).toThrow(),
);
it('never exposes secret in configuration error', () => {
  try {
    loadPaymentConfig({
      ...fixture,
      YOOKASSA_SECRET_KEY: 'live_sensitive_material',
    });
    throw new Error('expected failure');
  } catch (e) {
    expect(String(e)).not.toContain('live_sensitive_material');
    expect(String(e)).toContain('redacted');
  }
});
