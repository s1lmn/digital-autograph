import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  IdentityService,
  OAuthAttemptService,
  SessionService,
} from '../../packages/auth/src/index';
import {
  createDatabase,
  createPgOAuthAttemptRepository,
  createPgProviderIdentityRepository,
  createPgSessionRepository,
} from '../../packages/db/src/index';
import { createYandexOAuthClient } from '../../packages/integrations/src/yandex';
import { buildApi } from '../../apps/api/src/app';
import { YandexLoginService } from '../../apps/api/src/auth/yandex-login';
import { loadYandexAuthConfig } from '../../packages/config/src/index';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/autograph_test')
  throw new Error('Yandex integration tests require the isolated test DB');
const db = createDatabase(databaseUrl);
const attempts = new OAuthAttemptService(
  createPgOAuthAttemptRepository(db.pool),
  600,
);
const identities = new IdentityService(
  createPgProviderIdentityRepository(db.pool),
);
const sessions = new SessionService(
  createPgSessionRepository(db.pool),
  1209600,
);
const webOrigin = 'http://127.0.0.1:3000';
const redirectUri = 'http://127.0.0.1:4000/auth/yandex/callback';
const providerConfig = {
  clientId: 'test-yandex-client',
  clientSecret: 'synthetic-secret',
  redirectUri,
};
const sensitiveMarker = 'synthetic-private-provider-response';

function createApp(
  enabled = true,
  environment: 'test' | 'staging' | 'production' = 'test',
  stream?: { write: (line: string) => void },
) {
  const challenges = new Map<string, string>();
  const subjects = new Map<string, string>();
  const requests: string[] = [];
  const adapter = createYandexOAuthClient(
    providerConfig,
    async (url, options) => {
      requests.push(String(url));
      if (String(url).endsWith('/token')) {
        const body = options?.body as URLSearchParams;
        const [state, subject] = (body.get('code') ?? '').split('.');
        const challenge = createHash('sha256')
          .update(body.get('code_verifier') ?? '')
          .digest('base64url');
        if (!state || challenges.get(state) !== challenge || subject === 'fail')
          return new Response(sensitiveMarker, { status: 400 });
        const token = `synthetic_${state}`;
        subjects.set(token, subject!);
        return Response.json({
          token_type: 'bearer',
          access_token: token,
          refresh_token: sensitiveMarker,
        });
      }
      const token =
        new Headers(options?.headers).get('Authorization')?.slice(6) ?? '';
      return Response.json({
        id: subjects.get(token),
        client_id: providerConfig.clientId,
        default_email: 'same@example.test',
        login: 'same-name',
        default_avatar_id: 'same-avatar',
      });
    },
  );
  const login = new YandexLoginService(
    attempts,
    {
      authorizationUrl(input) {
        challenges.set(input.state, input.codeChallenge);
        return adapter.authorizationUrl(input);
      },
      verifyCode: adapter.verifyCode,
    },
    identities,
    sessions,
  );
  const args: Parameters<typeof buildApi> = [
    db,
    sessions,
    {
      appEnvironment: environment,
      sessionTtlSeconds: 1209600,
      trustedWebOrigins: [webOrigin],
    },
  ];
  if (enabled)
    args[18] = {
      login,
      config: { appEnvironment: environment, webOrigin, redirectUri },
    };
  args[20] = stream;
  const app = buildApi(...args);
  return { app, requests, login };
}
const host = { host: '127.0.0.1:4000' };
type App = ReturnType<typeof createApp>['app'];
async function start(app: App, returnTo = '/walls/example') {
  const response = await app.inject({
    url: `/auth/yandex/start?returnTo=${encodeURIComponent(returnTo)}`,
    headers: host,
  });
  expect(response.statusCode).toBe(302);
  const url = new URL(response.headers.location!);
  const cookies = response.cookies
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  expect(url.searchParams.has('nonce')).toBe(false);
  expect(url.searchParams.get('redirect_uri')).toBe(redirectUri);
  return { state: url.searchParams.get('state')!, cookies, response };
}
async function finish(
  app: App,
  attempt: Awaited<ReturnType<typeof start>>,
  subject = '123456',
) {
  return app.inject({
    url: `/auth/yandex/callback?state=${attempt.state}&code=${attempt.state}.${subject}`,
    headers: { ...host, cookie: attempt.cookies },
  });
}
function sessionCookie(response: Awaited<ReturnType<typeof finish>>) {
  return response.cookies
    .filter((c) => c.name.endsWith('da_session'))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}
async function count(table: string) {
  return Number(
    (await db.pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count,
  );
}

beforeAll(async () => {
  await db.checkConnection();
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE TABLE users CASCADE');
  await db.pool.query('TRUNCATE TABLE oauth_login_attempts');
});
afterAll(async () => {
  await db.pool.query('TRUNCATE TABLE users CASCADE');
  await db.pool.query('TRUNCATE TABLE oauth_login_attempts');
  await db.close();
});

describe('Yandex isolated PostgreSQL login', () => {
  it('creates a new user and session, then returns the same account on repeat login', async () => {
    const { app } = createApp();
    try {
      const first = await finish(app, await start(app));
      expect(first.headers.location).toBe(`${webOrigin}/walls/example`);
      const user = (
        await app.inject({
          url: '/auth/me',
          headers: { cookie: sessionCookie(first) },
        })
      ).json().user;
      const repeated = await finish(app, await start(app));
      expect(
        (
          await app.inject({
            url: '/auth/me',
            headers: { cookie: sessionCookie(repeated) },
          })
        ).json().user.id,
      ).toBe(user.id);
      expect(await count('users')).toBe(1);
      expect(await count('social_identities')).toBe(1);
      expect(await count('sessions')).toBe(2);
      expect(await count('user_roles')).toBe(0);
      expect(
        (await db.pool.query('SELECT provider FROM social_identities')).rows[0]
          .provider,
      ).toBe('yandex');
    } finally {
      await app.close();
    }
  });
  it('serializes concurrent first logins without duplicate users or orphan identities', async () => {
    const { app } = createApp();
    try {
      const starts = await Promise.all(
        Array.from({ length: 6 }, () => start(app)),
      );
      const results = await Promise.all(starts.map((a) => finish(app, a)));
      expect(results.every((r) => !!sessionCookie(r))).toBe(true);
      expect(await count('users')).toBe(1);
      expect(await count('social_identities')).toBe(1);
    } finally {
      await app.close();
    }
  });
  it('allows only one concurrent callback/token exchange and rejects replay', async () => {
    const { app, requests } = createApp();
    try {
      const a = await start(app);
      const results = await Promise.all([finish(app, a), finish(app, a)]);
      expect(results.filter((r) => sessionCookie(r)).length).toBe(1);
      expect((await finish(app, a)).headers.location).toContain(
        'YANDEX_AUTH_FAILED',
      );
      expect(requests.filter((r) => r.endsWith('/token')).length).toBe(1);
      expect(await count('sessions')).toBe(1);
    } finally {
      await app.close();
    }
  });
  it.each([
    'state',
    'binding',
    'missing-binding',
    'missing-verifier',
    'verifier',
  ])(
    'rejects stolen/mismatched callback (%s) before contacting Yandex',
    async (variant) => {
      const { app, requests } = createApp();
      try {
        const a = await start(app);
        const stolen = await start(app);
        if (variant === 'state') a.state = 'x'.repeat(43);
        if (variant === 'binding')
          a.cookies = a.cookies.replace(
            /da_yandex_oauth=[^;]+/,
            `da_yandex_oauth=${stolen.response.cookies.find((c) => c.name === 'da_yandex_oauth')!.value}`,
          );
        if (variant === 'missing-binding')
          a.cookies = a.cookies.replace(/da_yandex_oauth=[^;]+;? ?/, '');
        if (variant === 'missing-verifier')
          a.cookies = a.cookies.replace(/da_yandex_pkce=[^;]+;? ?/, '');
        if (variant === 'verifier')
          a.cookies = a.cookies.replace(
            /da_yandex_pkce=[^;]+/,
            `da_yandex_pkce=${'v'.repeat(43)}`,
          );
        expect((await finish(app, a)).headers.location).toContain(
          'YANDEX_AUTH_FAILED',
        );
        expect(requests).toHaveLength(0);
        expect(await count('users')).toBe(0);
      } finally {
        await app.close();
      }
    },
  );
  it('rejects expired and missing state, duplicate parameters and wrong callback host', async () => {
    const { app, requests } = createApp();
    try {
      const a = await start(app);
      await db.pool.query(
        "UPDATE oauth_login_attempts SET created_at = statement_timestamp() - interval '700 seconds', expires_at = statement_timestamp() - interval '100 seconds'",
      );
      expect((await finish(app, a)).headers.location).toContain(
        'YANDEX_AUTH_FAILED',
      );
      for (const query of [
        'code=example',
        `state=${a.state}&state=${a.state}&code=x`,
        `state=${a.state}&code=x&code=y`,
      ]) {
        expect(
          (
            await app.inject({
              url: `/auth/yandex/callback?${query}`,
              headers: { ...host, cookie: a.cookies },
            })
          ).headers.location,
        ).toContain('YANDEX_AUTH_FAILED');
      }
      expect(
        (
          await app.inject({
            url: `/auth/yandex/callback?state=${a.state}&code=x`,
            headers: { host: 'evil.example', cookie: a.cookies },
          })
        ).headers.location,
      ).toContain('YANDEX_AUTH_FAILED');
      expect(requests).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
  it('returns safely on missing code, cancellation, API failure and code/error ambiguity', async () => {
    const { app } = createApp();
    try {
      expect(
        (await finish(app, await start(app), 'fail')).headers.location,
      ).toContain('YANDEX_AUTH_FAILED');
      for (const suffix of [
        '',
        '&error=access_denied',
        '&error=access_denied&code=ambiguous',
      ]) {
        const a = await start(app);
        const r = await app.inject({
          url: `/auth/yandex/callback?state=${a.state}${suffix}`,
          headers: { ...host, cookie: a.cookies },
        });
        expect(r.headers.location).toContain(
          suffix === '&error=access_denied'
            ? 'YANDEX_AUTH_CANCELLED'
            : 'YANDEX_AUTH_FAILED',
        );
      }
      expect(await count('users')).toBe(0);
    } finally {
      await app.close();
    }
  });
  it.each(['disabled', 'anonymized'])(
    'does not authenticate a %s account',
    async (status) => {
      const { app } = createApp();
      try {
        await finish(app, await start(app));
        await db.pool.query('UPDATE users SET status=$1', [status]);
        expect(
          (await finish(app, await start(app))).headers.location,
        ).toContain('YANDEX_AUTH_FAILED');
        expect(await count('users')).toBe(1);
        expect(await count('sessions')).toBe(1);
      } finally {
        await app.close();
      }
    },
  );
  it('does not merge same profile or existing Google/Telegram identities and preserves prior sessions', async () => {
    const { app } = createApp();
    try {
      const google = await identities.resolveOrCreateUser('google', '123456');
      const telegram = await identities.resolveOrCreateUser(
        'telegram',
        '123456',
      );
      const issued = await sessions.createSession(google);
      const before = await db.pool.query(
        'SELECT * FROM social_identities ORDER BY provider',
      );
      await finish(app, await start(app), '123456');
      await finish(app, await start(app), '987654');
      expect(await count('users')).toBe(4);
      expect(await sessions.validateSession(issued.token)).toMatchObject({
        user: { id: google },
      });
      const after = await db.pool.query(
        "SELECT * FROM social_identities WHERE provider <> 'yandex' ORDER BY provider",
      );
      expect(after.rows).toEqual(before.rows);
      expect(telegram).not.toBe(google);
    } finally {
      await app.close();
    }
  });
  it('rejects identity ownership conflict at the DB unique constraint', async () => {
    await identities.resolveOrCreateUser('yandex', '123456');
    const other = await identities.resolveOrCreateUser('google', 'other');
    await expect(
      db.pool.query(
        "INSERT INTO social_identities (user_id,provider,provider_user_id) VALUES ($1, 'yandex', '123456')",
        [other],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    expect(await count('users')).toBe(2);
    expect(await count('social_identities')).toBe(2);
  });
  it('never switches or links an authenticated session on start/callback', async () => {
    const { app, requests } = createApp();
    try {
      const userId = await identities.resolveOrCreateUser('google', 'existing');
      const issued = await sessions.createSession(userId);
      const cookie = `da_session=${issued.token}`;
      expect(
        (
          await app.inject({
            url: '/auth/yandex/start',
            headers: { ...host, cookie },
          })
        ).statusCode,
      ).toBe(409);
      const a = await start(app);
      a.cookies += `; ${cookie}`;
      const r = await finish(app, a);
      expect(r.headers.location).toContain('ALREADY_AUTHENTICATED');
      expect(sessionCookie(r)).toBe('');
      expect(await sessions.validateSession(issued.token)).toMatchObject({
        user: { id: userId },
      });
      expect(await count('social_identities')).toBe(1);
      expect(requests).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
  it('has no Yandex routes when disabled or unapproved and only returns safe availability', async () => {
    expect(loadYandexAuthConfig({})).toBeNull();
    expect(loadYandexAuthConfig({ YANDEX_AUTH_ENABLED: 'true' })).toBeNull();
    const { app } = createApp(false);
    try {
      expect((await app.inject('/auth/providers')).json()).toEqual({
        vk_id: false,
        yandex: false,
      });
      expect((await app.inject('/auth/yandex/start')).statusCode).toBe(404);
      expect(
        (await app.inject('/auth/yandex/callback?code=x&state=y')).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });
  it.each([
    '//evil.example',
    '/\\\\evil.example',
    'https://evil.example',
    '/%2f%2fevil.example',
  ])('rejects unsafe return path %s', async (returnTo) => {
    const { app } = createApp();
    try {
      expect(
        (await finish(app, await start(app, returnTo))).headers.location,
      ).toBe(`${webOrigin}/`);
    } finally {
      await app.close();
    }
  });
  it('uses secure short-lived cookies in production and clears verifier/binding after callback', async () => {
    const { app } = createApp(true, 'production');
    try {
      const a = await start(app);
      for (const cookie of a.response.cookies) {
        expect(cookie.name).toMatch(/^__Host-da_yandex_/);
        expect(cookie.secure).toBe(true);
        expect(cookie.httpOnly).toBe(true);
        expect(cookie.sameSite).toBe('Lax');
        expect(cookie.maxAge).toBe(600);
        expect(cookie.domain).toBeUndefined();
      }
      const r = await finish(app, a);
      expect(
        r.cookies
          .filter((c) => c.name.startsWith('__Host-da_yandex_'))
          .every((c) => c.value === ''),
      ).toBe(true);
      expect(
        r.cookies.find((c) => c.name === '__Host-da_session')?.secure,
      ).toBe(true);
    } finally {
      await app.close();
    }
  });
  it('does not log query secrets, verifier, cookies or raw provider failures', async () => {
    let output = '';
    const { app } = createApp(true, 'test', {
      write: (line) => {
        output += line;
      },
    });
    try {
      const a = await start(app);
      const r = await finish(app, a, 'fail');
      await app.close();
      expect(output).toContain('incoming request');
      expect(output).not.toContain(sensitiveMarker);
      expect(output).not.toContain(a.state);
      for (const cookie of a.response.cookies)
        expect(output).not.toContain(cookie.value);
      expect(JSON.stringify(r.headers) + r.body).not.toContain(sensitiveMarker);
    } finally {
      await app.close();
    }
  });
});
