import { describe, expect, it } from 'vitest';
import { loadApiConfig } from './index';

const base = {
  APP_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5433/autograph_test',
  API_HOST: '127.0.0.1',
  API_PORT: '4000',
  SESSION_TTL_SECONDS: '1209600',
  TRUSTED_WEB_ORIGINS: 'http://127.0.0.1:3000',
  WEB_ORIGIN: 'http://127.0.0.1:3000',
  GOOGLE_CLIENT_ID: 'test-client',
  GOOGLE_CLIENT_SECRET: 'test-secret',
  GOOGLE_REDIRECT_URI: 'http://127.0.0.1:4000/auth/google/callback',
  TELEGRAM_CLIENT_ID: 'test-client',
  TELEGRAM_CLIENT_SECRET: 'test-secret',
  TELEGRAM_REDIRECT_URI: 'http://127.0.0.1:4000/auth/telegram/callback',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'autographs-test',
};

describe('operator incident settings', () => {
  it('preserves existing behavior when settings are omitted', () => {
    expect(loadApiConfig(base)).toMatchObject({
      DISABLE_NEW_PAYMENTS: false,
      DISABLE_FREE_CLAIMS: false,
    });
  });

  it.each(['true', 'false'])(
    'parses exact %s independently for each switch',
    (value) => {
      for (const key of ['DISABLE_NEW_PAYMENTS', 'DISABLE_FREE_CLAIMS']) {
        const result = loadApiConfig({ ...base, [key]: value });
        expect(result).toMatchObject({
          DISABLE_NEW_PAYMENTS: false,
          DISABLE_FREE_CLAIMS: false,
          [key]: value === 'true',
        });
      }
    },
  );

  it.each(['', 'TRUE', 'False', '1', '0', 'yes', ' true ', 'secret-canary'])(
    'rejects ambiguous setting %j without printing its value',
    (value) => {
      for (const key of ['DISABLE_NEW_PAYMENTS', 'DISABLE_FREE_CLAIMS']) {
        let failure: unknown;
        try {
          loadApiConfig({ ...base, [key]: value });
        } catch (error) {
          failure = error;
        }
        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toContain(key);
        expect((failure as Error).message).not.toContain('secret-canary');
      }
    },
  );
});
