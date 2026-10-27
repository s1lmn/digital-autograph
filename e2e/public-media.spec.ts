import { randomUUID } from 'node:crypto';
import { placements } from '../packages/db/src/schema';
import { placementFixture } from '../tests/integration/fixtures';
import { e2eSlotId, e2eUserId, e2eWallId, expect, test } from './fixtures';

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
