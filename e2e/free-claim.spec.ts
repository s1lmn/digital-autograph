import { expect, test } from '@playwright/test';
import { e2eWallId } from './fixtures';

const webUrl = process.env.E2E_WEB_URL ?? 'http://127.0.0.1:3000';
const apiUrl = process.env.API_PUBLIC_ORIGIN ?? 'http://127.0.0.1:4000';

test('returns from test auth and persists a free claim after reload', async ({
  page,
}) => {
  await page.goto(`${webUrl}/autograph/create`);
  await expect(
    page.getByRole('heading', { name: 'Create a digital autograph' }),
  ).toBeVisible();

  await page.goto(
    `${apiUrl}/auth/test/start?returnTo=${encodeURIComponent('/autograph/create')}`,
  );
  await expect(page).toHaveURL(`${webUrl}/autograph/create`);
  await expect(
    page.getByRole('heading', { name: 'Draw your autograph' }),
  ).toBeVisible();

  await page.goto(`${webUrl}/walls/${e2eWallId}`);
  await expect(
    page.getByRole('heading', { name: "E2E Creator's Wall" }),
  ).toBeVisible();
  await expect(
    page.getByRole('radio', { name: /Drawn autograph/ }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Claim this slot' }).click();
  await page.getByRole('button', { name: 'Confirm free claim' }).click();
  await expect(
    page.getByText('Your autograph is on the Wall.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('listitem', { name: 'Slot 1' })).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole('heading', { name: "E2E Creator's Wall" }),
  ).toBeVisible();
  await expect(page.getByRole('listitem', { name: 'Slot 1' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Claim this slot' }),
  ).toHaveCount(0);

  const wallResponse = await page.request.get(`${apiUrl}/walls/${e2eWallId}`);
  expect(wallResponse.ok()).toBeTruthy();
  const wall = await wallResponse.json();
  expect(wall.slots[0]).toMatchObject({
    occupied: true,
    currentPlacement: { source: 'free_claim' },
  });
});
