import { expect, it } from 'vitest';
import { renderEnvironment } from '../../../deploy/manual-env.mjs';
import { loadPaymentConfig } from '../../../packages/config/src/index';
import { loadApiStartupConfig } from '../src/startup-config';
const original = {
  APP_ENV: 'staging',
  DATABASE_URL: 'postgresql://legacy:synthetic@postgres/autograph_test',
  API_HOST: '0.0.0.0',
  API_PORT: '4000',
  SESSION_TTL_SECONDS: '1209600',
  WEB_ORIGIN: 'https://old.invalid',
  TRUSTED_WEB_ORIGINS: 'https://old.invalid',
  GOOGLE_CLIENT_ID: 'synthetic-client',
  GOOGLE_CLIENT_SECRET: 'synthetic-google',
  GOOGLE_REDIRECT_URI: 'https://old-api.invalid/auth/google/callback',
  TELEGRAM_CLIENT_ID: 'synthetic-client',
  TELEGRAM_CLIENT_SECRET: 'synthetic-telegram',
  TELEGRAM_REDIRECT_URI: 'https://old-api.invalid/auth/telegram/callback',
  S3_ENDPOINT: 'https://storage.invalid',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'synthetic',
  S3_ACCESS_KEY_ID: 'synthetic',
  S3_SECRET_ACCESS_KEY: 'synthetic',
  PAYMENT_PROVIDER: 'yookassa',
  PAYMENT_MODE: 'sandbox',
  YOOKASSA_SHOP_ID: '12345',
  YOOKASSA_SECRET_KEY: 'test_synthetic_not_real',
  PAYMENT_RETURN_URL: 'https://old.invalid/payments/return',
  PAYMENT_CREATOR_SHARE_BPS: '5000',
};
it('clears the complete previously valid sandbox configuration; exact startup loaders accept disabled provider without hiding invalid config', () => {
  expect(loadPaymentConfig(original)?.PAYMENT_MODE).toBe('sandbox');
  const source =
    Object.entries(original)
      .map(([k, v]) => `${k}='${v}'`)
      .join('\n') + '\n';
  const generated = renderEnvironment('api', source, {
    database: 'autograph_test',
    domains: { web: 'new.invalid', api: 'api.new.invalid' },
  });
  const env = Object.fromEntries(
    generated
      .trim()
      .split('\n')
      .map((line) => {
        const i = line.indexOf('=');
        return [line.slice(0, i), line.slice(i + 2, -1)];
      }),
  );
  expect(
    Object.keys(env).filter((k) => /^(PAYMENT_|YOOKASSA_)/.test(k)),
  ).toEqual([]);
  expect(loadPaymentConfig(env)).toBeNull();
  const startup = loadApiStartupConfig(undefined, env);
  expect(startup.paymentConfig).toBeNull();
  expect(startup.config.DISABLE_NEW_PAYMENTS).toBe(true);
  const partial: { [key: string]: string | undefined } = {
    ...original,
    DISABLE_NEW_PAYMENTS: 'true',
    YOOKASSA_SHOP_ID: undefined,
    YOOKASSA_SECRET_KEY: undefined,
  };
  expect(() => loadApiStartupConfig(undefined, partial)).toThrow(
    'Invalid payment configuration (values redacted)',
  );
  expect(generated.includes(original.YOOKASSA_SECRET_KEY)).toBe(false);
});
