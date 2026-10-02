import { e2eUserId, e2eWallId, expect, test } from './fixtures';

const apiUrl = process.env.API_PUBLIC_ORIGIN ?? 'http://127.0.0.1:4000';
const webUrl = process.env.E2E_WEB_URL ?? 'http://127.0.0.1:3000';

test('new user uploads, reviews, claims and reads only their persistent history', async ({
  page,
  scenario,
}) => {
  expect((await page.request.get(`${apiUrl}/auth/me`)).status()).toBe(401);
  const initial = await scenario.database.pool.query(
    'SELECT id FROM autographs WHERE user_id = $1',
    [e2eUserId],
  );
  expect(initial.rowCount).toBe(0);
  await page.goto('/autograph/create');
  await expect(
    page.getByRole('heading', { name: 'Sign in to continue' }),
  ).toBeVisible();
  await page.goto(
    `${apiUrl}/auth/test/start?returnTo=${encodeURIComponent('/autograph/create')}`,
  );
  await expect(page).toHaveURL(`${webUrl}/autograph/create`);
  const canvas = page.getByLabel('Autograph drawing area', { exact: true });
  await expect(
    page.getByRole('heading', { name: 'Draw your autograph' }),
  ).toBeVisible();
  await canvas.focus();
  await canvas.press('Space');
  for (const key of [
    'ArrowRight',
    'ArrowRight',
    'ArrowRight',
    'ArrowDown',
    'ArrowDown',
    'ArrowLeft',
    'ArrowLeft',
    'ArrowDown',
    'ArrowRight',
    'ArrowRight',
  ])
    await canvas.press(key);
  await canvas.press('Space');
  const created = page.waitForResponse(
    (response) =>
      response.url() === `${apiUrl}/autographs` &&
      response.request().method() === 'POST',
  );
  const upload = page.waitForResponse(
    (response) =>
      response.url().startsWith(process.env.S3_ENDPOINT!) &&
      response.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: 'Create private preview' }).click();
  const autograph = await (await created).json();
  const uploaded = await upload;
  expect(uploaded.status()).toBe(200);
  expect(uploaded.request().headers()).toMatchObject({
    'content-type': 'image/png',
    'if-none-match': '*',
  });
  await expect(
    page.getByRole('heading', { name: 'Your cleaned preview' }),
  ).toBeVisible({ timeout: 30_000 });
  const preview = page.getByRole('img', {
    name: 'Cleaned digital autograph preview',
  });
  await expect(preview).toBeVisible();
  await expect
    .poll(() =>
      preview.evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      ),
    )
    .toBe(true);
  const assets = await scenario.database.pool.query<{ storage_key: string }>(
    'SELECT storage_key FROM autograph_assets WHERE autograph_id = $1',
    [autograph.id],
  );
  expect(assets.rows).toHaveLength(2);
  for (const asset of assets.rows) {
    const unsigned = await page.request.get(
      `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}/${asset.storage_key}`,
    );
    expect(unsigned.status()).toBe(403);
  }
  await page
    .getByRole('button', { name: 'Approve and submit for moderation' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Submitted for moderation' }),
  ).toBeVisible();
  const moderator = await scenario.actorContext(scenario.ownerId);
  const decision = await moderator.request.post(
    `${apiUrl}/moderation/autographs/${autograph.id}/decision`,
    { headers: { Origin: webUrl }, data: { decision: 'approved' } },
  );
  expect(decision.status()).toBe(200);

  await page.goto(`/walls/${e2eWallId}`);
  await expect(
    page.getByRole('heading', { name: "E2E Creator's Wall" }),
  ).toBeVisible();
  const history = page.getByRole('region', { name: 'Placement history' });
  await expect(
    history.getByText('No placements have been recorded yet.'),
  ).toBeVisible();
  await expect(
    page.getByRole('radio', { name: /Drawn autograph/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Claim this slot' }).click();
  await page.getByRole('button', { name: 'Confirm free claim' }).click();
  await expect(
    page.getByText('Your autograph is on the Wall.', { exact: true }),
  ).toBeVisible();
  await expect(history.getByText('Current placement')).toBeVisible();
  await expect(page.getByRole('listitem', { name: 'Slot 1' })).toBeVisible();
  await expect(history.getByText('Free Claim', { exact: true })).toBeVisible();
  await expect(history.getByRole('heading', { name: 'Slot 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh Wall', exact: true }).click();
  await expect(history.getByText('Current placement')).toBeVisible();
  await page.reload();
  await expect(history.getByText('Current placement')).toBeVisible();
  await expect(page.getByRole('listitem', { name: 'Slot 1' })).toBeVisible();
  const publicWall = await page.request.get(`${apiUrl}/walls/${e2eWallId}`);
  expect(publicWall.ok()).toBeTruthy();
  expect((await publicWall.json()).slots[0]).toMatchObject({
    occupied: true,
    currentPlacement: { source: 'free_claim' },
  });
  await expect(
    page.getByRole('button', { name: 'Claim this slot' }),
  ).toHaveCount(0);
  await page.getByRole('link', { name: 'View your placement history' }).click();
  await expect(
    page.getByRole('link', { name: "E2E Creator's Wall" }),
  ).toHaveAttribute('href', `/walls/${e2eWallId}`);
  await expect(page.getByText('Current placement')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Current placement')).toBeVisible();
  const mine = await page.request.get(`${apiUrl}/me/placements`);
  expect(mine.status()).toBe(200);
  expect((await mine.json()).items).toHaveLength(1);
  const otherHistory = await moderator.request.get(`${apiUrl}/me/placements`);
  expect((await otherHistory.json()).items).toEqual([]);
  const invariant = await scenario.database.pool.query(
    'SELECT count(*)::int AS active FROM placements WHERE ended_at IS NULL',
  );
  expect(invariant.rows[0].active).toBe(1);
  const claims = await scenario.database.pool.query(
    'SELECT count(*)::int AS claims FROM wall_free_claims WHERE user_id = $1 AND wall_id = $2',
    [e2eUserId, e2eWallId],
  );
  expect(claims.rows[0].claims).toBe(1);
  expect(
    (
      await page.request.post(`${apiUrl}/auth/logout`, {
        headers: { Origin: webUrl },
      })
    ).status(),
  ).toBe(204);
  await page.reload();
  await expect(
    page.getByText('Sign in to view your placement history.'),
  ).toBeVisible();
  await expect(page.getByText('Current placement')).toHaveCount(0);
  expect((await page.request.get(`${apiUrl}/me/placements`)).status()).toBe(
    401,
  );
});
