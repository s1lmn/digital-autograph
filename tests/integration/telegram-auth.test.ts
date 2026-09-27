import { createHash } from 'node:crypto';
import {
  IdentityService,
  OAuthAttemptService,
  SessionService,
} from '../../packages/auth/src/index';
import { buildApi } from '../../apps/api/src/app';
import { GoogleLoginService } from '../../apps/api/src/auth/google-login';
import type { AuthHttpConfig } from '../../apps/api/src/auth/http';
import { TelegramLoginService } from '../../apps/api/src/auth/telegram-login';
import {
  createDatabase,
  createPgOAuthAttemptRepository,
  createPgProviderIdentityRepository,
  createPgSessionRepository,
  eq,
} from '../../packages/db/src/index';
import {
  oauthLoginAttempts,
  sessions,
  socialIdentities,
  users,
} from '../../packages/db/src/schema';
import type { GoogleOidcClient } from '../../packages/integrations/src/google';
import type { TelegramOidcClient } from '../../packages/integrations/src/telegram';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (
  !testDatabaseUrl ||
  new URL(testDatabaseUrl).pathname !== '/autograph_test'
) {
  throw new Error('Telegram integration tests require the isolated test DB');
}

const database = createDatabase(testDatabaseUrl);
const attempts = new OAuthAttemptService(
  createPgOAuthAttemptRepository(database.pool),
  600,
);
const identities = new IdentityService(
  createPgProviderIdentityRepository(database.pool),
);
const sessionService = new SessionService(
  createPgSessionRepository(database.pool),
  1209600,
);
const authConfig: AuthHttpConfig = {
  appEnvironment: 'test',
  sessionTtlSeconds: 1209600,
  trustedWebOrigins: ['http://127.0.0.1:3000'],
};

class FakeTelegram implements TelegramOidcClient {
  calls = 0;
  lastNonce = '';
  lastVerifier = '';

  async authorizationUrl(input: {
    state: string;
    nonce: string;
    codeChallenge: string;
  }): Promise<string> {
    this.lastNonce = input.nonce;
    const url = new URL('https://oauth.telegram.org/auth');
    url.searchParams.set('client_id', 'test-telegram-client');
    url.searchParams.set(
      'redirect_uri',
      'http://127.0.0.1:4000/auth/telegram/callback',
    );
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid profile');
    url.searchParams.set('state', input.state);
    url.searchParams.set('nonce', input.nonce);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.href;
  }

  async verifyCode(input: {
    code: string;
    state: string;
    nonce: string;
    codeVerifier: string;
  }): Promise<{ subject: string }> {
    this.calls += 1;
    this.lastVerifier = input.codeVerifier;
    if (input.code.startsWith('invalid-') || input.code === 'exchange-failed') {
      throw new Error('Sensitive Telegram provider error');
    }
    if (input.nonce !== this.lastNonce) throw new Error('Invalid nonce');
    return { subject: input.code };
  }
}

class FakeGoogle implements GoogleOidcClient {
  nonce = '';
  authorizationUrl(input: { state: string; nonce: string }): string {
    this.nonce = input.nonce;
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('state', input.state);
    return url.href;
  }
  async verifyCode() {
    return { subject: 'google-sub', nonce: this.nonce };
  }
}

function createApp(
  fake = new FakeTelegram(),
  environment = authConfig.appEnvironment,
) {
  const login = new TelegramLoginService(
    attempts,
    fake,
    identities,
    sessionService,
  );
  const google = new GoogleLoginService(
    attempts,
    new FakeGoogle(),
    identities,
    sessionService,
  );
  const app = buildApi(
    database,
    sessionService,
    { ...authConfig, appEnvironment: environment },
    {
      login: google,
      config: {
        appEnvironment: environment,
        webOrigin: 'http://127.0.0.1:3000',
      },
    },
    {
      login,
      config: {
        appEnvironment: environment,
        webOrigin: 'http://127.0.0.1:3000',
      },
    },
  );
  return { app, fake };
}

type Started = {
  state: string;
  nonce: string;
  cookies: string;
  bindingCookie: string;
  pkceCookie: string;
  codeVerifier: string;
};

async function start(
  app: ReturnType<typeof createApp>['app'],
  returnTo?: string,
) {
  const query =
    returnTo === undefined ? '' : `?returnTo=${encodeURIComponent(returnTo)}`;
  const response = await app.inject(`/auth/telegram/start${query}`);
  expect(response.statusCode).toBe(302);
  const url = new URL(String(response.headers.location));
  const state = url.searchParams.get('state');
  const nonce = url.searchParams.get('nonce');
  if (!state || !nonce) throw new Error('Expected state and nonce');
  const cookieHeaders = response.headers['set-cookie'];
  const cookieValues = Array.isArray(cookieHeaders)
    ? cookieHeaders
    : [cookieHeaders];
  const bindingCookie = cookieValues
    .find((value) => String(value).includes('da_telegram_oauth='))
    ?.split(';')[0];
  const pkceCookie = cookieValues
    .find((value) => String(value).includes('da_telegram_pkce='))
    ?.split(';')[0];
  if (!bindingCookie || !pkceCookie) throw new Error('Expected OAuth cookies');
  const codeVerifier = pkceCookie.split('=')[1]?.split('.')[0];
  if (!codeVerifier) throw new Error('Expected PKCE verifier');
  const result: Started = {
    state,
    nonce,
    cookies: `${bindingCookie}; ${pkceCookie}`,
    bindingCookie,
    pkceCookie,
    codeVerifier,
  };
  return { result, response, url, cookieValues };
}

async function callback(
  app: ReturnType<typeof createApp>['app'],
  started: Started,
  code: string | null = 'telegram-sub-1',
  override: { state?: string; cookies?: string; error?: string } = {},
) {
  const query = new URLSearchParams();
  query.set('state', override.state ?? started.state);
  if (code !== null) query.set('code', code);
  if (override.error) query.set('error', override.error);
  return app.inject({
    url: `/auth/telegram/callback?${query}`,
    headers: { cookie: override.cookies ?? started.cookies },
  });
}

function sessionCookie(
  response: Awaited<ReturnType<ReturnType<typeof createApp>['app']['inject']>>,
) {
  const values = response.headers['set-cookie'];
  const cookie = (Array.isArray(values) ? values : [values])
    .find((value) => String(value).startsWith('da_session='))
    ?.split(';')[0];
  if (!cookie) throw new Error('Expected local session cookie');
  return cookie;
}

describe('Telegram Authentication with PostgreSQL', () => {
  beforeAll(async () => database.checkConnection());
  beforeEach(async () => {
    await database.pool.query('TRUNCATE oauth_login_attempts');
    await database.pool.query('TRUNCATE users CASCADE');
  });
  afterAll(async () => database.close());

  it('starts OIDC code flow with minimal scopes, S256, random secrets and hashed persistence', async () => {
    const { app } = createApp();
    try {
      const first = await start(app, '/wall/abc?tab=history');
      const second = await start(app);
      expect(first.url.origin).toBe('https://oauth.telegram.org');
      expect(first.url.pathname).toBe('/auth');
      expect(first.url.searchParams.get('client_id')).toBe(
        'test-telegram-client',
      );
      expect(first.url.searchParams.get('redirect_uri')).toBe(
        'http://127.0.0.1:4000/auth/telegram/callback',
      );
      expect(first.url.searchParams.get('response_type')).toBe('code');
      expect(first.url.searchParams.get('scope')).toBe('openid profile');
      expect(first.url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(first.url.searchParams.get('code_challenge')).toBe(
        createHash('sha256')
          .update(first.result.codeVerifier)
          .digest('base64url'),
      );
      expect(first.result.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(first.result.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(first.result.state).not.toBe(second.result.state);
      expect(first.result.codeVerifier).not.toBe(second.result.codeVerifier);
      expect(first.result.bindingCookie).not.toBe(second.result.bindingCookie);
      for (const cookie of first.cookieValues) {
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('SameSite=Lax');
        expect(cookie).toContain('Path=/');
        expect(cookie).toContain('Max-Age=600');
      }
      const stored = await database.db
        .select()
        .from(oauthLoginAttempts)
        .where(
          eq(
            oauthLoginAttempts.stateHash,
            createHash('sha256').update(first.result.state).digest('hex'),
          ),
        );
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        provider: 'telegram',
        returnPath: '/wall/abc?tab=history',
      });
      expect(stored[0]?.pkceVerifierHash).toBe(
        createHash('sha256').update(first.result.codeVerifier).digest('hex'),
      );
      expect(stored[0]?.nonceHash).not.toBe(first.result.nonce);
      expect(first.response.headers['cache-control']).toBe('no-store');
      expect(first.response.headers['referrer-policy']).toBe('no-referrer');
    } finally {
      await app.close();
    }
  });

  it.each([
    'https://evil.test',
    '//evil.test',
    'javascript:alert(1)',
    '/\\evil.test',
    '/%2f%2fevil.test',
  ])('normalizes unsafe returnTo %s to root', async (returnTo) => {
    const { app } = createApp();
    try {
      const started = (await start(app, returnTo)).result;
      expect((await callback(app, started)).headers.location).toBe(
        'http://127.0.0.1:3000/',
      );
    } finally {
      await app.close();
    }
  });

  it('creates and reuses one Telegram identity with local sessions', async () => {
    const { app } = createApp();
    try {
      const first = (await start(app, '/creator/example')).result;
      const loggedIn = await callback(app, first);
      expect(loggedIn.headers.location).toBe(
        'http://127.0.0.1:3000/creator/example',
      );
      expect(loggedIn.headers['set-cookie']).toContainEqual(
        expect.stringContaining('da_telegram_oauth=;'),
      );
      expect(loggedIn.headers['set-cookie']).toContainEqual(
        expect.stringContaining('da_telegram_pkce=;'),
      );
      const me = await app.inject({
        url: '/auth/me',
        headers: { cookie: sessionCookie(loggedIn) },
      });
      const userId = me.json().user.id as string;
      expect(await database.db.select().from(users)).toHaveLength(1);
      expect(await database.db.select().from(socialIdentities)).toMatchObject([
        { userId, provider: 'telegram', providerUserId: 'telegram-sub-1' },
      ]);
      expect(await database.db.select().from(sessions)).toHaveLength(1);
      expect((await callback(app, first)).headers.location).toContain(
        'TELEGRAM_AUTH_FAILED',
      );

      const second = (await start(app)).result;
      const again = await callback(app, second);
      const againMe = await app.inject({
        url: '/auth/me',
        headers: { cookie: sessionCookie(again) },
      });
      expect(againMe.json().user.id).toBe(userId);
      expect(await database.db.select().from(users)).toHaveLength(1);
      expect(await database.db.select().from(socialIdentities)).toHaveLength(1);
      expect(await database.db.select().from(sessions)).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it('separates different Telegram subs and Google accounts regardless of similar profile', async () => {
    const googleUser = await identities.resolveOrCreateUser(
      'google',
      'same-name',
    );
    const { app } = createApp();
    try {
      const first = await callback(app, (await start(app)).result, 'same-name');
      const second = await callback(
        app,
        (await start(app)).result,
        'other-sub',
      );
      const firstId = (
        await app.inject({
          url: '/auth/me',
          headers: { cookie: sessionCookie(first) },
        })
      ).json().user.id;
      const secondId = (
        await app.inject({
          url: '/auth/me',
          headers: { cookie: sessionCookie(second) },
        })
      ).json().user.id;
      expect(firstId).not.toBe(googleUser);
      expect(secondId).not.toBe(firstId);
      expect(await database.db.select().from(users)).toHaveLength(3);
    } finally {
      await app.close();
    }
  });

  it('rejects disabled and anonymized linked Users', async () => {
    const userId = await identities.resolveOrCreateUser(
      'telegram',
      'telegram-sub-1',
    );
    const { app } = createApp();
    try {
      for (const status of ['disabled', 'anonymized'] as const) {
        await database.db
          .update(users)
          .set({ status })
          .where(eq(users.id, userId));
        expect(
          (await callback(app, (await start(app)).result)).headers.location,
        ).toContain('TELEGRAM_AUTH_FAILED');
      }
      expect(await database.db.select().from(users)).toHaveLength(1);
      expect(await database.db.select().from(sessions)).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('serializes concurrent first identity resolution without orphan Users', async () => {
    const [first, second] = await Promise.all([
      identities.resolveOrCreateUser('telegram', 'racing-sub'),
      identities.resolveOrCreateUser('telegram', 'racing-sub'),
    ]);
    expect(first).toBe(second);
    expect(await database.db.select().from(users)).toHaveLength(1);
    expect(await database.db.select().from(socialIdentities)).toHaveLength(1);
  });

  it('rejects missing, unknown, mismatched, expired and consumed attempts before exchange', async () => {
    const { app, fake } = createApp();
    try {
      const valid = (await start(app)).result;
      const missing = await app.inject({
        url: '/auth/telegram/callback?code=telegram-sub-1',
        headers: { cookie: valid.cookies },
      });
      expect(missing.headers.location).toContain('TELEGRAM_AUTH_FAILED');
      expect(
        (await callback(app, valid, null, { state: 'malformed' })).headers
          .location,
      ).toContain('TELEGRAM_AUTH_FAILED');
      expect(
        (await callback(app, valid, null, { state: 'A'.repeat(43) })).headers
          .location,
      ).toContain('TELEGRAM_AUTH_FAILED');
      expect(
        (
          await callback(app, valid, null, {
            cookies: `da_telegram_oauth=${'B'.repeat(43)}; ${valid.pkceCookie}`,
          })
        ).headers.location,
      ).toContain('TELEGRAM_AUTH_FAILED');
      expect(
        (await callback(app, valid, null, { cookies: valid.bindingCookie }))
          .headers.location,
      ).toContain('TELEGRAM_AUTH_FAILED');
      expect(
        (
          await callback(app, valid, null, {
            cookies: `${valid.bindingCookie}; da_telegram_pkce=${'C'.repeat(43)}.${valid.nonce}`,
          })
        ).headers.location,
      ).toContain('TELEGRAM_AUTH_FAILED');
      expect(
        (
          await callback(app, valid, null, {
            cookies: `${valid.bindingCookie}; da_telegram_pkce=${valid.codeVerifier}.${'D'.repeat(43)}`,
          })
        ).headers.location,
      ).toContain('TELEGRAM_AUTH_FAILED');
      expect(fake.calls).toBe(0);
      expect((await callback(app, valid)).headers.location).toBe(
        'http://127.0.0.1:3000/',
      );
      expect(fake.calls).toBe(1);
      for (const lifecycle of ['expired', 'consumed']) {
        const started = (await start(app)).result;
        const hash = createHash('sha256').update(started.state).digest('hex');
        if (lifecycle === 'expired') {
          await database.pool.query(
            "UPDATE oauth_login_attempts SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE state_hash = $1",
            [hash],
          );
        } else {
          await database.pool.query(
            'UPDATE oauth_login_attempts SET consumed_at = now() WHERE state_hash = $1',
            [hash],
          );
        }
        expect((await callback(app, started)).headers.location).toContain(
          'TELEGRAM_AUTH_FAILED',
        );
      }
      expect(fake.calls).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('consumes denial, missing code and provider validation failures safely', async () => {
    const { app } = createApp();
    try {
      const denied = (await start(app)).result;
      const cancelled = await callback(app, denied, null, {
        error: 'access_denied',
      });
      expect(cancelled.headers.location).toContain('TELEGRAM_AUTH_CANCELLED');
      expect(cancelled.headers['set-cookie']).toContainEqual(
        expect.stringContaining('da_telegram_oauth=;'),
      );
      expect(cancelled.headers['set-cookie']).toContainEqual(
        expect.stringContaining('da_telegram_pkce=;'),
      );
      expect((await callback(app, denied)).headers.location).toContain(
        'TELEGRAM_AUTH_FAILED',
      );
      expect(
        (await callback(app, (await start(app)).result, null)).headers.location,
      ).toContain('TELEGRAM_AUTH_FAILED');
      for (const code of [
        'invalid-token',
        'invalid-issuer',
        'invalid-audience',
        'invalid-expired',
        'exchange-failed',
      ]) {
        const failed = await callback(app, (await start(app)).result, code);
        expect(failed.headers.location).toContain('TELEGRAM_AUTH_FAILED');
        expect(failed.body).not.toContain('Sensitive Telegram provider error');
      }
      expect(await database.db.select().from(sessions)).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('allows only one concurrent callback for one attempt', async () => {
    const { app } = createApp();
    try {
      const started = (await start(app)).result;
      const responses = await Promise.all([
        callback(app, started),
        callback(app, started),
      ]);
      expect(
        responses.filter(
          (response) => response.headers.location === 'http://127.0.0.1:3000/',
        ),
      ).toHaveLength(1);
      expect(await database.db.select().from(users)).toHaveLength(1);
      expect(await database.db.select().from(sessions)).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('keeps authenticated Users from starting or completing a replacement login', async () => {
    const userId = await identities.resolveOrCreateUser('google', 'existing');
    const session = await sessionService.createSession(userId);
    const { app } = createApp();
    try {
      const blockedStart = await app.inject({
        url: '/auth/telegram/start',
        headers: { cookie: `da_session=${session.token}` },
      });
      expect(blockedStart.statusCode).toBe(409);
      const started = (await start(app)).result;
      const blockedCallback = await callback(app, started, 'telegram-sub-1', {
        cookies: `${started.cookies}; da_session=${session.token}`,
      });
      expect(blockedCallback.headers.location).toContain(
        'ALREADY_AUTHENTICATED',
      );
      expect(await database.db.select().from(users)).toHaveLength(1);
      expect(await database.db.select().from(socialIdentities)).toHaveLength(1);
      expect(await database.db.select().from(sessions)).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('isolates Google and Telegram attempts in both callback directions', async () => {
    const { app } = createApp();
    try {
      const telegram = (await start(app)).result;
      const googleStart = await app.inject('/auth/google/start');
      const googleUrl = new URL(String(googleStart.headers.location));
      const googleState = googleUrl.searchParams.get('state');
      const googleCookie = String(googleStart.headers['set-cookie']).split(
        ';',
      )[0];
      if (!googleState) throw new Error('Expected Google state');
      const wrongTelegram = await app.inject({
        url: `/auth/telegram/callback?state=${googleState}&code=telegram-sub-1`,
        headers: { cookie: telegram.cookies },
      });
      expect(wrongTelegram.headers.location).toContain('TELEGRAM_AUTH_FAILED');
      const wrongGoogle = await app.inject({
        url: `/auth/google/callback?state=${telegram.state}&code=google-sub`,
        headers: { cookie: googleCookie },
      });
      expect(wrongGoogle.headers.location).toContain('GOOGLE_AUTH_FAILED');
      expect((await callback(app, telegram)).headers.location).toBe(
        'http://127.0.0.1:3000/',
      );
      expect(
        (
          await app.inject({
            url: `/auth/google/callback?state=${googleState}&code=google-sub`,
            headers: { cookie: googleCookie },
          })
        ).headers.location,
      ).toBe('http://127.0.0.1:3000/');
      expect(await database.db.select().from(users)).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it('uses Secure host-only temporary cookies in production', async () => {
    const { app } = createApp(new FakeTelegram(), 'production');
    try {
      const response = await app.inject('/auth/telegram/start');
      const cookies = response.headers['set-cookie'];
      expect(cookies).toHaveLength(2);
      for (const value of Array.isArray(cookies) ? cookies : [cookies]) {
        expect(value).toContain('__Host-da_telegram_');
        expect(value).toContain('HttpOnly');
        expect(value).toContain('Secure');
        expect(value).toContain('SameSite=Lax');
        expect(value).toContain('Path=/');
        expect(value).not.toContain('Domain=');
      }
    } finally {
      await app.close();
    }
  });
});
