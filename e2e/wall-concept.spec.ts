import { placements, slots } from '../packages/db/src/schema';
import { randomUUID } from 'node:crypto';
import { placementFixture, slotFixture } from '../tests/integration/fixtures';
import { e2eSlotId, e2eUserId, e2eWallId, expect, test } from './fixtures';

test('public wall poster and slot grid remain readable with filtering, fragments and enlarged text', async ({
  page,
  scenario,
}, testInfo) => {
  await scenario.database.pool.query(
    "UPDATE walls SET slot_count = 10, status = 'paused' WHERE id = $1",
    [e2eWallId],
  );
  const extraSlots = Array.from({ length: 9 }, (_, index) =>
    slotFixture(e2eWallId, index + 2, index + 1),
  );
  await scenario.database.db.insert(slots).values(extraSlots);
  await scenario.database.db.insert(placements).values([
    { ...placementFixture(e2eSlotId, e2eUserId, 1), source: 'admin' },
    { ...placementFixture(extraSlots[0]!.id!, e2eUserId, 2), source: 'admin' },
  ]);
  await page.goto(`/walls/${e2eWallId}`);
  const grid = page.getByRole('list', { name: 'Wall slots' });
  await expect(grid.getByRole('listitem')).toHaveCount(10);
  await expect(
    page.getByText('Showing 10 of 10 slots.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /claim/i })).toHaveCount(0);
  const emptyFilter = page.getByRole('button', {
    name: 'Empty slots',
    exact: true,
  });
  await page.getByRole('link', { name: 'View the slots', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Slots', exact: true }),
  ).toBeFocused();
  await emptyFilter.focus();
  await page.keyboard.press('Space');
  await expect(grid.getByRole('listitem')).toHaveCount(8);
  await expect(
    grid.getByRole('listitem', { name: 'Slot 3', exact: true }),
  ).toHaveAttribute('value', '3');
  await expect(
    grid.getByRole('listitem', { name: 'Slot 1', exact: true }),
  ).toHaveCount(0);
  await page.evaluate((id) => {
    window.location.hash = `slot-${id}`;
  }, e2eSlotId);
  await expect(
    grid.getByRole('listitem', { name: 'Slot 1', exact: true }),
  ).toBeFocused();
  await expect(grid.getByRole('listitem')).toHaveCount(10);

  // A native anchor to the unchanged fragment emits no hashchange. It must
  // still reveal and focus the occupied slot after filtering it out again.
  await page.evaluate((id) => {
    const anchor = document.createElement('a');
    anchor.href = `#slot-${id}`;
    anchor.textContent = 'Revisit occupied slot';
    document.querySelector('main')!.prepend(anchor);
  }, e2eSlotId);
  const repeatedLink = page.getByRole('link', {
    name: 'Revisit occupied slot',
    exact: true,
  });
  for (const activation of ['mouse', 'keyboard']) {
    await emptyFilter.click();
    await expect(grid.getByRole('listitem')).toHaveCount(8);
    await expect(emptyFilter).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(new RegExp(`#slot-${e2eSlotId}$`));
    if (activation === 'keyboard') {
      await repeatedLink.focus();
      await page.keyboard.press('Enter');
    } else await repeatedLink.click();
    await expect(emptyFilter).toHaveAttribute('aria-pressed', 'false');
    await expect(grid.getByRole('listitem')).toHaveCount(10);
    await expect(
      grid.getByRole('listitem', { name: 'Slot 1', exact: true }),
    ).toBeFocused();
  }

  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    const columns = await grid.evaluate(
      (element) =>
        getComputedStyle(element).gridTemplateColumns.split(' ').length,
    );
    expect(columns).toBe(width > 1024 ? 4 : 2);
    const box = await emptyFilter.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    if (width === 1440 || width === 320)
      await page.screenshot({
        path: testInfo.outputPath(`wall-grid-${width}.png`),
        fullPage: true,
      });
  }

  const longName =
    'A creator with a very long public display name and OneUnbrokenNameThatMustStillFitOnANarrowScreen';
  await scenario.database.pool.query(
    'UPDATE creator_profiles SET display_name = $1',
    [longName],
  );
  await page.reload();
  await expect(
    page.getByRole('heading', { name: `${longName}'s Wall`, exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
  await emptyFilter.focus();
  await page.keyboard.press('Space');
  await expect(grid.getByRole('listitem')).toHaveCount(8);
  await expect(emptyFilter).toBeFocused();
  await page.screenshot({
    path: testInfo.outputPath('wall-grid-320-enlarged-text.png'),
    fullPage: true,
  });
});

test('an image that fails before hydration still exposes occupied-state retry', async ({
  page,
  scenario,
}) => {
  const autograph = randomUUID();
  const asset = randomUUID();
  const approval = randomUUID();
  await scenario.database.pool.query(
    "INSERT INTO autographs (id,user_id,source,status) VALUES ($1,$2,'canvas','ready')",
    [autograph, e2eUserId],
  );
  await scenario.database.pool.query(
    `INSERT INTO autograph_assets (id,autograph_id,role,status,storage_key,
      actual_content_type,verified_size_bytes,width,height,uploaded_at)
      VALUES ($1,$2,'cleaned','uploaded',$3,'image/png',96,10,10,now())`,
    [asset, autograph, `synthetic-early-failure/${asset}.png`],
  );
  await scenario.database.pool.query(
    'INSERT INTO autograph_user_approvals (id,autograph_id,user_id,cleaned_asset_id) VALUES ($1,$2,$3,$4)',
    [approval, autograph, e2eUserId, asset],
  );
  await scenario.database.pool.query(
    `INSERT INTO autograph_moderation_decisions
      (autograph_id,moderator_user_id,user_approval_id,cleaned_asset_id,decision)
      VALUES ($1,$2,$3,$4,'approved')`,
    [autograph, scenario.ownerId, approval, asset],
  );
  await scenario.database.db.insert(placements).values({
    ...placementFixture(e2eSlotId, e2eUserId, 1),
    autographId: autograph,
    source: 'admin',
  });
  // Finish the failed image while the client scripts are still loading.
  await page.route(/\/_next\/static\/.*\.js(?:\?|$)/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });
  await page.route('**/public/placements/*/autograph', (route) =>
    route.fulfill({ status: 404, body: '' }),
  );
  await page.goto(`/walls/${e2eWallId}`);
  const slot = page.getByRole('listitem', { name: 'Slot 1', exact: true });
  await expect(slot).toHaveAttribute('data-occupied', 'true');
  await expect(
    slot.getByText('Autograph unavailable', { exact: true }),
  ).toBeVisible();
  await expect(
    slot.getByRole('button', { name: 'Retry autograph' }),
  ).toBeVisible();
  await expect(
    slot.getByRole('button', { name: 'Claim this slot' }),
  ).toHaveCount(0);
  await slot.getByRole('button', { name: 'Retry autograph' }).click();
  await expect(
    slot.getByText('Autograph unavailable', { exact: true }),
  ).toBeVisible();
});
