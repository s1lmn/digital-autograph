import { createHash } from 'node:crypto';
import {
  IdentityService,
  OAuthAttemptService,
  SessionService,
} from '../../packages/auth/src/index';
import { buildApi } from '../../apps/api/src/app';
import { GoogleLoginService } from '../../apps/api/src/auth/google-login';
import type { AuthHttpConfig } from '../../apps/api/src/auth/http';
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
import { userFixture } from './fixtures';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (
  !testDatabaseUrl ||
  new URL(testDatabaseUrl).pathname !== '/autograph_test'
) {
  throw new Error(
    'Google integration tests require the isolated test database',
  );
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

class FakeGoogle implements GoogleOidcClient {
  nonce = '';
  exchangeCalls = 0;
  invalidNonce = false;
  email = 'shared@example.test';

  authorizationUrl(input: { state: string; nonce: string }): string {
    this.nonce = input.nonce;
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', 'test-client');
    url.searchParams.set(
      'redirect_uri',
      'http://127.0.0.1:4000/auth/google/callback',
    );
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', input.state);
    url.searchParams.set('nonce', input.nonce);
    return url.toString();
  }

  async verifyCode(code: string) {
    this.exchangeCalls += 1;
    if (code.startsWith('invalid-') || code === 'exchange-failed') {
      throw new Error('Sensitive provider failure');
    }
    return {
      subject: code,
      nonce: this.invalidNonce ? 'wrong-nonce' : this.nonce,
      email: this.email,
      emailVerified: true,
    };
  }
}

function createApp(
  fake = new FakeGoogle(),
  environment = authConfig.appEnvironment,
) {
  const login = new GoogleLoginService(
    attempts,
    fake,
    identities,
    sessionService,
  );
  const app = buildApi(
    database,
    sessionService,
    {
      ...authConfig,
      appEnvironment: environment,
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
  bindingCookie: string;
};

async function start(
  app: ReturnType<typeof createApp>['app'],
  returnTo?: string,
): Promise<{
  result: Started;
  response: Awaited<ReturnType<typeof app.inject>>;
}> {
  const query =
    returnTo === undefined ? '' : `?returnTo=${encodeURIComponent(returnTo)}`;
  const response = await app.inject(`/auth/google/start${query}`);
  expect(response.statusCode).toBe(302);
  const location = new URL(String(response.headers.location));
  const state = location.searchParams.get('state');
  const nonce = location.searchParams.get('nonce');
  if (!state || !nonce) throw new Error('Expected OAuth state and nonce');
  const bindingCookie = String(response.headers['set-cookie']).split(';')[0];
  if (!bindingCookie) throw new Error('Expected browser-binding cookie');
  return { result: { state, nonce, bindingCookie }, response };
}

async function callback(
  app: ReturnType<typeof createApp>['app'],
  started: Started,
  code: string | null = 'google-sub-1',
  override: { state?: string; cookie?: string; error?: string } = {},
) {
  const query = new URLSearchParams();
  query.set('state', override.state ?? started.state);
  if (code !== null) query.set('code', code);
  if (override.error) query.set('error', override.error);
  return app.inject({
    method: 'GET',
    url: `/auth/google/callback?${query}`,
    headers: { cookie: override.cookie ?? started.bindingCookie },
  });
}

function sessionCookie(
  response: Awaited<ReturnType<ReturnType<typeof createApp>['app']['inject']>>,
) {
  const headers = response.headers['set-cookie'];
  const values = Array.isArray(headers) ? headers : [headers];
  const found = values.find((value) => String(value).startsWith('da_session='));
  if (!found) throw new Error('Expected application session cookie');
  const cookie = String(found).split(';')[0];
  if (!cookie) throw new Error('Expected application session cookie value');
  return cookie;
}

describe('Google Authentication with PostgreSQL', () => {
  beforeAll(async () => database.checkConnection());
  beforeEach(async () => {
    await database.pool.query('TRUNCATE oauth_login_attempts');
    await database.pool.query('TRUNCATE users CASCADE');
  });
  afterAll(async () => database.close());

  it('starts with random state, nonce, browser binding and only hashes in the database', async () => {
    const { app } = createApp();
    try {
      const first = await start(app, '/wall/abc?tab=history');
      const second = await start(app);
      const url = new URL(String(first.response.headers.location));
      expect(url.hostname).toBe('accounts.google.com');
      expect(url.searchParams.get('client_id')).toBe('test-client');
      expect(url.searchParams.get('redirect_uri')).toBe(
        'http://127.0.0.1:4000/auth/google/callback',
      );
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('scope')?.split(' ').sort()).toEqual([
        'email',
        'openid',
        'profile',
      ]);
      expect(first.result.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(first.result.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(first.result.state).not.toBe(second.result.state);
      expect(first.result.nonce).not.toBe(second.result.nonce);
      expect(first.result.bindingCookie).not.toBe(second.result.bindingCookie);
      expect(first.response.headers['set-cookie']).toContain('HttpOnly');
      expect(first.response.headers['set-cookie']).toContain('SameSite=Lax');
      expect(first.response.headers['set-cookie']).toContain('Path=/');
      expect(first.response.headers['set-cookie']).toContain('Max-Age=600');
      expect(first.response.headers['referrer-policy']).toBe('no-referrer');
      expect(first.response.headers['cache-control']).toBe('no-store');
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
      expect(stored[0]?.provider).toBe('google');
      expect(stored[0]?.returnPath).toBe('/wall/abc?tab=history');
      expect(stored[0]?.stateHash).not.toBe(first.result.state);
      expect(stored[0]?.nonceHash).not.toBe(first.result.nonce);
      expect(stored[0]?.browserBindingHash).not.toContain(
        first.result.bindingCookie.split('=')[1],
      );
    } finally {
      await app.close();
    }
  });

  it.each([
    'https://evil.example',
    '//evil.example',
    'javascript:alert(1)',
    '/\\evil.example',
    '/%2f%2fevil.example',
  ])('normalizes unsafe returnTo %s to root', async (returnTo) => {
    const { app } = createApp();
    try {
      const { result } = await start(app, returnTo);
      const success = await callback(app, result);
      expect(success.headers.location).toBe('http://127.0.0.1:3000/');
    } finally {
      await app.close();
    }
  });

  it('creates a User, Google identity and local session, then reuses the User', async () => {
    const { app } = createApp();
    try {
      const first = (await start(app, '/creator/example')).result;
      const loggedIn = await callback(app, first);
      expect(loggedIn.statusCode).toBe(302);
      expect(loggedIn.headers.location).toBe(
        'http://127.0.0.1:3000/creator/example',
      );
      expect(loggedIn.headers['referrer-policy']).toBe('no-referrer');
      expect(loggedIn.headers['set-cookie']).toContainEqual(
        expect.stringContaining('da_google_oauth=;'),
      );
      const localCookie = sessionCookie(loggedIn);
      const token = localCookie.split('=')[1];
      if (!token) throw new Error('Expected local session token');
      expect(loggedIn.headers.location).not.toContain(token);
      expect(loggedIn.body).not.toContain(token);
      const me = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { cookie: localCookie },
      });
      expect(me.statusCode).toBe(200);
      const userId = me.json().user.id as string;
      expect(await database.db.select().from(users)).toHaveLength(1);
      expect(await database.db.select().from(socialIdentities)).toMatchObject([
        { userId, provider: 'google', providerUserId: 'google-sub-1' },
      ]);
      expect(await database.db.select().from(sessions)).toHaveLength(1);
      expect((await callback(app, first)).headers.location).toBe(
        'http://127.0.0.1:3000/auth/error?code=GOOGLE_AUTH_FAILED',
      );
      const second = (await start(app)).result;
      const again = await callback(app, second);
      const againMe = await app.inject({
        method: 'GET',
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

  it('keeps different subs and a same-email Telegram identity as separate Users', async () => {
    const telegram = (
      await database.db.insert(users).values(userFixture(40)).returning()
    )[0];
    if (!telegram) throw new Error('Expected Telegram User');
    await database.db.insert(socialIdentities).values({
      userId: telegram.id,
      provider: 'telegram',
      providerUserId: 'telegram-sub',
      providerUsername: 'shared@example.test',
    });
    const { app, fake } = createApp();
    fake.email = 'shared@example.test';
    try {
      const one = await callback(
        app,
        (await start(app)).result,
        'google-sub-1',
      );
      const two = await callback(
        app,
        (await start(app)).result,
        'google-sub-2',
      );
      const oneUser = (
        await app.inject({
          url: '/auth/me',
          headers: { cookie: sessionCookie(one) },
        })
      ).json().user.id;
      const twoUser = (
        await app.inject({
          url: '/auth/me',
          headers: { cookie: sessionCookie(two) },
        })
      ).json().user.id;
      expect(oneUser).not.toBe(twoUser);
      expect(oneUser).not.toBe(telegram.id);
      expect(twoUser).not.toBe(telegram.id);
      expect(await database.db.select().from(users)).toHaveLength(3);
    } finally {
      await app.close();
    }
  });

  it('rejects a disabled or anonymized linked User without creating another', async () => {
    const userId = await identities.resolveOrCreateUser(
      'google',
      'google-sub-1',
    );
    const { app } = createApp();
    try {
      for (const status of ['disabled', 'anonymized'] as const) {
        await database.db
          .update(users)
          .set({ status })
          .where(eq(users.id, userId));
        const denied = await callback(app, (await start(app)).result);
        expect(denied.headers.location).toBe(
          'http://127.0.0.1:3000/auth/error?code=GOOGLE_AUTH_FAILED',
        );
      }
      expect(await database.db.select().from(users)).toHaveLength(1);
      expect(await database.db.select().from(socialIdentities)).toHaveLength(1);
      expect(await database.db.select().from(sessions)).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('serializes concurrent first identity resolution without orphan Users', async () => {
    const [first, second] = await Promise.all([
      identities.resolveOrCreateUser('google', 'racing-sub'),
      identities.resolveOrCreateUser('google', 'racing-sub'),
    ]);
    expect(first).toBe(second);
    expect(await database.db.select().from(users)).toHaveLength(1);
    expect(await database.db.select().from(socialIdentities)).toHaveLength(1);
  });

  it('rejects missing, random, mismatched, expired and consumed attempts before exchange', async () => {
    const { app, fake } = createApp();
    try {
      const valid = (await start(app)).result;
      const missing = await app.inject({
        method: 'GET',
        url: '/auth/google/callback?code=google-sub-1',
        headers: { cookie: valid.bindingCookie },
      });
      expect(missing.headers.location).toContain('GOOGLE_AUTH_FAILED');
      expect(
        (await callback(app, valid, null, { state: 'A'.repeat(43) })).headers
          .location,
      ).toContain('GOOGLE_AUTH_FAILED');
      expect(
        (
          await callback(app, valid, null, {
            cookie: 'da_google_oauth=' + 'B'.repeat(43),
          })
        ).headers.location,
      ).toContain('GOOGLE_AUTH_FAILED');
      expect(fake.exchangeCalls).toBe(0);
      const legitimate = await callback(app, valid);
      expect(legitimate.headers.location).toBe('http://127.0.0.1:3000/');
      expect(fake.exchangeCalls).toBe(1);

      const expired = (await start(app)).result;
      await database.pool.query(
        "UPDATE oauth_login_attempts SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE state_hash = $1",
        [createHash('sha256').update(expired.state).digest('hex')],
      );
      expect((await callback(app, expired)).headers.location).toContain(
        'GOOGLE_AUTH_FAILED',
      );

      const consumed = (await start(app)).result;
      await database.pool.query(
        'UPDATE oauth_login_attempts SET consumed_at = now() WHERE state_hash = $1',
        [createHash('sha256').update(consumed.state).digest('hex')],
      );
      expect((await callback(app, consumed)).headers.location).toContain(
        'GOOGLE_AUTH_FAILED',
      );
      expect(fake.exchangeCalls).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('consumes denial, missing code, invalid token, invalid issuer/audience, nonce mismatch and exchange failure', async () => {
    const { app, fake } = createApp();
    try {
      const denied = (await start(app)).result;
      expect(
        (await callback(app, denied, null, { error: 'access_denied' })).headers
          .location,
      ).toContain('GOOGLE_AUTH_CANCELLED');
      expect((await callback(app, denied)).headers.location).toContain(
        'GOOGLE_AUTH_FAILED',
      );
      expect(
        (await callback(app, (await start(app)).result, null)).headers.location,
      ).toContain('GOOGLE_AUTH_FAILED');
      for (const code of [
        'invalid-token',
        'invalid-issuer',
        'invalid-audience',
        'exchange-failed',
      ]) {
        const failed = await callback(app, (await start(app)).result, code);
        expect(failed.headers.location).toContain('GOOGLE_AUTH_FAILED');
        expect(failed.body).not.toContain('Sensitive provider failure');
      }
      fake.invalidNonce = true;
      expect(
        (await callback(app, (await start(app)).result)).headers.location,
      ).toContain('GOOGLE_AUTH_FAILED');
      expect(await database.db.select().from(sessions)).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('allows only one concurrent callback for one state and browser binding', async () => {
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

  it('does not silently replace or link an already-authenticated account', async () => {
    const existingUser = (
      await database.db.insert(users).values(userFixture(41)).returning()
    )[0];
    if (!existingUser) throw new Error('Expected existing User');
    const existingSession = await sessionService.createSession(existingUser.id);
    const { app } = createApp();
    try {
      const blockedStart = await app.inject({
        url: '/auth/google/start',
        headers: { cookie: `da_session=${existingSession.token}` },
      });
      expect(blockedStart.statusCode).toBe(409);
      const started = (await start(app)).result;
      const blockedCallback = await callback(app, started, 'google-sub-1', {
        cookie: `${started.bindingCookie}; da_session=${existingSession.token}`,
      });
      expect(blockedCallback.headers.location).toContain(
        'ALREADY_AUTHENTICATED',
      );
      expect(
        await sessionService.validateSession(existingSession.token),
      ).not.toBeNull();
      expect(await database.db.select().from(socialIdentities)).toHaveLength(0);
      expect(await database.db.select().from(sessions)).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('uses Secure host-only temporary cookies in production', async () => {
    const { app } = createApp(new FakeGoogle(), 'production');
    try {
      const response = await app.inject('/auth/google/start');
      const cookie = String(response.headers['set-cookie']);
      expect(cookie).toContain('__Host-da_google_oauth=');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Path=/');
      expect(cookie).not.toContain('Domain=');
    } finally {
      await app.close();
    }
  });
});
