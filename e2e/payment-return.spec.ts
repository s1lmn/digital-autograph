import { test, expect } from '@playwright/test';
// UI contract fixtures only. Real money/locking lives in PostgreSQL integration tests.
test('provider return is navigation only; status comes from the owner-only backend', async ({
  page,
}) => {
  const orderId = '11111111-1111-4111-8111-111111111111';
  let state = 'provider_pending';
  let calls = 0;
  await page.route(`**/payments/orders/${orderId}/refresh`, async (route) => {
    calls++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({});
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: state }),
    });
  });
  await page.goto(
    `/payments/return?orderId=${orderId}&status=succeeded&paid=true`,
  );
  await expect(page.getByRole('status')).toHaveText('Payment is pending.');
  state = 'paid_but_not_fulfilled';
  await page.getByRole('button', { name: 'Refresh payment status' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Manual review is required',
  );
  expect(calls).toBeGreaterThanOrEqual(2);
});
test('anonymous payment return does not expose an order', async ({ page }) => {
  await page.route('**/payments/orders/*/refresh', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
  );
  await page.goto(
    '/payments/return?orderId=11111111-1111-4111-8111-111111111111',
  );
  await expect(page.getByRole('status')).toHaveText(
    'Sign in to view your payment.',
  );
});
