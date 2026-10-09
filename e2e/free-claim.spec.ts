import sharp from 'sharp';
import { type Locator, type Page } from '@playwright/test';
import { e2eUserId, e2eWallId, expect, test } from './fixtures';

const apiUrl = process.env.API_PUBLIC_ORIGIN ?? 'http://127.0.0.1:4000';
const webUrl = process.env.E2E_WEB_URL ?? 'http://127.0.0.1:3000';

const widths = [320, 375, 390, 768, 1440];
async function responsive(page: Page, action?: Locator) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        page.evaluate(() => ({
          viewport: document.documentElement.clientWidth,
          content: document.documentElement.scrollWidth,
        })),
      )
      .toEqual({ viewport: width, content: width });
    for (const canvas of await page.locator('canvas').all()) {
      const box = await canvas.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThan(64);
      expect(box!.height).toBeGreaterThan(32);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(box!.width / box!.height).toBeCloseTo(2, 1);
    }
    if (action) {
      await expect(action).toBeVisible();
      const box = await action.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  }
  await page.setViewportSize({ width: 390, height: 900 });
}

test('new user uploads, reviews, claims and reads only their persistent history', async ({
  page,
  scenario,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Leave your mark on a creator’s Wall' }),
  ).toBeVisible();
  await responsive(
    page,
    page.getByRole('link', { name: 'Create a digital autograph', exact: true }),
  );
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Skip to content' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
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
  await responsive(
    page,
    page.getByRole('link', { name: 'Continue with Google' }),
  );
  await page.goto(
    `${apiUrl}/auth/test/start?returnTo=${encodeURIComponent('/autograph/create')}`,
  );
  await expect(page).toHaveURL(`${webUrl}/autograph/create`);
  const canvas = page.getByLabel('Autograph drawing area', { exact: true });
  await expect(
    page.getByRole('heading', { name: 'Draw your autograph' }),
  ).toBeVisible();
  await responsive(
    page,
    page.getByRole('button', { name: 'Create private preview' }),
  );
  await page.getByRole('button', { name: 'Photo', exact: true }).click();
  const syntheticPhoto = await sharp(
    Buffer.from(
      '<svg width="1200" height="600" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="600" fill="white"/><path d="M200 300 Q400 150 600 320 T1000 250" fill="none" stroke="black" stroke-width="8"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({
    name: 'synthetic-autograph.png',
    mimeType: 'image/png',
    buffer: syntheticPhoto,
  });
  await expect(
    page.getByRole('img', { name: 'Edited autograph photo preview' }),
  ).toBeVisible();
  await responsive(
    page,
    page.getByRole('button', { name: 'Choose a photo', exact: true }),
  );
  await page.getByLabel('Crop preview').focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
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
  await responsive(
    page,
    page.getByRole('button', { name: 'Approve and submit for moderation' }),
  );
  await page.setViewportSize({ width: 320, height: 900 });
  await page.screenshot({
    path: testInfo.outputPath('preview-320.png'),
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Approve and submit for moderation' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Submitted for moderation' }),
  ).toBeVisible();
  await responsive(
    page,
    page.getByRole('button', { name: 'Start a new autograph' }),
  );
  const moderator = await scenario.actorContext(scenario.ownerId);
  const decision = await moderator.request.post(
    `${apiUrl}/moderation/autographs/${autograph.id}/decision`,
    { headers: { Origin: webUrl }, data: { decision: 'approved' } },
  );
  expect(decision.status()).toBe(200);

  await page.goto('/creators/e2e-creator');
  await expect(
    page.getByRole('heading', { name: 'E2E Creator', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle(
    'E2E Creator — public Walls | Digital Autograph',
  );
  await responsive(page);
  await page.getByRole('link', { name: 'E2E Creator’s Wall' }).click();
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
  await responsive(page, page.getByRole('button', { name: 'Claim this slot' }));
  await page.getByRole('button', { name: 'Empty slots', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(
    page.getByRole('button', { name: 'Empty slots', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Claim this slot' }).click();
  await expect(
    page.getByRole('heading', { name: 'Confirm your free claim' }),
  ).toBeFocused();
  await responsive(
    page,
    page.getByRole('button', { name: 'Confirm free claim' }),
  );
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Claim this slot' }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Claim this slot' }).click();
  await page.getByRole('button', { name: 'Confirm free claim' }).click();
  await expect(
    page.getByText('Your autograph is on the Wall.', { exact: true }),
  ).toBeVisible();
  await expect(history.getByText('Current placement')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'No empty slots in this view' }),
  ).toBeVisible();
  await expect(
    page.getByText('Showing 0 of 1 slots.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Show all slots' }).click();
  await expect(
    page.getByRole('button', { name: 'All slots', exact: true }),
  ).toBeFocused();
  await expect(page.getByRole('listitem', { name: 'Slot 1' })).toBeVisible();
  await expect(history.getByText('Free Claim', { exact: true })).toBeVisible();
  await expect(history.getByRole('heading', { name: 'Slot 1' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Paid takeover' }),
  ).toBeDisabled();
  await responsive(
    page,
    page.getByRole('button', { name: 'Refresh Wall', exact: true }),
  );
  await page.setViewportSize({ width: 320, height: 900 });
  await page.screenshot({
    path: testInfo.outputPath('wall-320.png'),
    fullPage: true,
  });
  await expect(history.getByRole('list')).toHaveCSS('list-style-type', 'none');
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'Refresh Wall', exact: true }).click();
  await expect(
    page.getByText('The Wall could not be refreshed. Try again.'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Retry Wall history' }),
  ).toBeVisible();
  await page.context().setOffline(false);
  await page.getByRole('button', { name: 'Retry Wall history' }).click();
  await expect(
    history.getByText('Wall placement history is temporarily unavailable.'),
  ).toHaveCount(0);
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
  await responsive(page);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    'noindex, nofollow',
  );
  await page.setViewportSize({ width: 320, height: 900 });
  await page.screenshot({
    path: testInfo.outputPath('history-320.png'),
    fullPage: true,
  });
  await expect(page.getByRole('main').getByRole('list')).toHaveCSS(
    'list-style-type',
    'none',
  );
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
  await page.getByRole('link', { name: 'Your account', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'You are signed in' }),
  ).toBeVisible();
  await responsive(
    page,
    page.getByRole('button', { name: 'Sign out', exact: true }),
  );
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Sign in to continue' }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Placement history', exact: true })
    .click();
  await expect(
    page.getByText('Sign in to view your placement history.'),
  ).toBeVisible();
  await expect(page.getByText('Current placement')).toHaveCount(0);
  expect((await page.request.get(`${apiUrl}/me/placements`)).status()).toBe(
    401,
  );
});
