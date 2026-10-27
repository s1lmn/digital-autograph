import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import {
  IdentityService,
  OAuthAttemptService,
  SessionService,
} from '../packages/auth/src/index';
import {
  createDatabase,
  createPgOAuthAttemptRepository,
  createPgProviderIdentityRepository,
  createPgSessionRepository,
} from '../packages/db/src/index';
import { createVkIdOAuthClient } from '../packages/integrations/src/vk-id';
import { buildApi } from '../apps/api/src/app';
import { VkIdLoginService } from '../apps/api/src/auth/vk-id-login';
import { e2eWallId, expect, test } from './fixtures';

const webOrigin = process.env.E2E_WEB_URL ?? 'http://127.0.0.1:3000';
const apiOrigin = process.env.API_PUBLIC_ORIGIN ?? 'http://127.0.0.1:4000';

test('VkId browser code flow returns to Wall, persists session, repeats safely and rejects replay', async ({
  page,
  scenario,
}) => {
  const reservation = createServer();
  await new Promise<void>((resolve) =>
    reservation.listen(0, '127.0.0.1', resolve),
  );
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const origin = `http://127.0.0.1:${address.port}`;
  const config = {
    clientId: '123456',
    serviceToken: 'synthetic-vk-id-e2e-service-token',
    redirectUri: `${origin}/auth/vk-id/callback`,
  };
  const database = createDatabase(process.env.DATABASE_URL!);
  const sessions = new SessionService(
    createPgSessionRepository(database.pool),
    1209600,
  );
  const challenges = new Map<string, string>();
  let exchanges = 0;
  const adapter = createVkIdOAuthClient(config, async (url, options) => {
    if (String(url).endsWith('/auth')) {
      exchanges += 1;
      const body = options?.body as URLSearchParams;
      const state = body.get('code')?.replace(/\.code$/, '') ?? '';
      const challenge = createHash('sha256')
        .update(body.get('code_verifier') ?? '')
        .digest('base64url');
      if (
        challenge !== challenges.get(state) ||
        body.get('state') !== state ||
        body.get('device_id') !== 'synthetic-device' ||
        body.get('service_token') !== config.serviceToken
      )
        return new Response('', { status: 400 });
      return Response.json({
        token_type: 'Bearer',
        expires_in: 600,
        state,
        user_id: 123456789,
        access_token: 'synthetic-e2e-access',
      });
    }
    return Response.json({
      user: { user_id: '123456789' },
    });
  });
  const login = new VkIdLoginService(
    new OAuthAttemptService(createPgOAuthAttemptRepository(database.pool), 600),
    {
      authorizationUrl(input) {
        challenges.set(input.state, input.codeChallenge);
        return adapter.authorizationUrl(input);
      },
      verifyCode: adapter.verifyCode,
    },
    new IdentityService(createPgProviderIdentityRepository(database.pool)),
    sessions,
  );
  const args: Parameters<typeof buildApi> = [
    database,
    sessions,
    {
      appEnvironment: 'test',
      sessionTtlSeconds: 1209600,
      trustedWebOrigins: [webOrigin],
    },
  ];
  args[19] = {
    login,
    config: {
      appEnvironment: 'test',
      webOrigin,
      redirectUri: config.redirectUri,
    },
  };
  const app = buildApi(...args);
  await app.listen({ host: '127.0.0.1', port: address.port });
  let lastCallback = '';
  await page.route('**/*', async (route) => {
    const requested = new URL(route.request().url());
    if (['127.0.0.1', 'localhost'].includes(requested.hostname))
      return route.continue();
    if (
      requested.origin !== 'https://id.vk.ru' ||
      requested.pathname !== '/authorize'
    )
      return route.abort();
    const url = new URL(route.request().url());
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.has('nonce')).toBe(false);
    const state = url.searchParams.get('state');
    lastCallback = `${config.redirectUri}?state=${state}&code=${state}.code&device_id=synthetic-device`;
    await route.fulfill({ status: 302, headers: { location: lastCallback } });
  });
  try {
    const started = await page.request.get(
      `${origin}/auth/vk-id/start?returnTo=${encodeURIComponent(`/walls/${e2eWallId}`)}`,
      { maxRedirects: 0 },
    );
    expect(started.status()).toBe(302);
    await page.goto(started.headers().location!);
    await expect(page).toHaveURL(`${webOrigin}/walls/${e2eWallId}`);
    const me = await page.request.get(`${apiOrigin}/auth/me`);
    expect(me.status()).toBe(200);
    const userId = (await me.json()).user.id;
    await page.reload();
    expect((await page.request.get(`${apiOrigin}/auth/me`)).status()).toBe(200);
    expect(exchanges).toBe(1);
    expect(
      (await page.request.get(lastCallback, { maxRedirects: 0 })).headers()
        .location,
    ).toContain('VK_AUTH_FAILED');
    expect(exchanges).toBe(1);
    expect(
      (
        await page.request.post(`${apiOrigin}/auth/logout`, {
          headers: { Origin: webOrigin },
        })
      ).status(),
    ).toBe(204);
    const repeatedStart = await page.request.get(
      `${origin}/auth/vk-id/start?returnTo=${encodeURIComponent(`/walls/${e2eWallId}`)}`,
      { maxRedirects: 0 },
    );
    expect(repeatedStart.status()).toBe(302);
    await page.goto(repeatedStart.headers().location!);
    await expect(page).toHaveURL(`${webOrigin}/walls/${e2eWallId}`);
    expect(
      (await (await page.request.get(`${apiOrigin}/auth/me`)).json()).user.id,
    ).toBe(userId);
    expect(exchanges).toBe(2);
    const rows = await scenario.database.pool.query(
      "SELECT count(*) FROM social_identities WHERE provider='vk_id'",
    );
    expect(Number(rows.rows[0].count)).toBe(1);
  } finally {
    await app.close();
    await database.close();
  }
});

test('default deployment exposes no VkId route or public button; UI uses server availability', async ({
  page,
  scenario,
}) => {
  void scenario;
  expect((await page.request.get(`${apiOrigin}/auth/providers`)).status()).toBe(
    200,
  );
  expect(
    await (await page.request.get(`${apiOrigin}/auth/providers`)).json(),
  ).toEqual({ yandex: false, vk_id: false });
  expect(
    (await page.request.get(`${apiOrigin}/auth/vk-id/start`)).status(),
  ).toBe(404);
  await page.goto('/me');
  await expect(
    page.getByRole('heading', { name: 'Sign in to continue' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Continue with VK ID' }),
  ).toHaveCount(0);
  // Component visibility only; this does not enable the runtime route.
  await page.route(`${apiOrigin}/auth/providers`, (route) =>
    route.fulfill({
      json: { vk_id: true },
      headers: {
        'Access-Control-Allow-Origin': webOrigin,
        'Access-Control-Allow-Credentials': 'true',
      },
    }),
  );
  await page.goto(`/walls/${e2eWallId}`);
  await page.getByRole('button', { name: 'Sign in to claim' }).click();
  const link = page.getByRole('link', { name: 'Continue with VK ID' });
  await expect(link).toHaveAttribute(
    'href',
    `${apiOrigin}/auth/vk-id/start?returnTo=${encodeURIComponent(`/walls/${e2eWallId}`)}`,
  );
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await link.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  }
});
