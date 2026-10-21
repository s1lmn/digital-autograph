import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { test, expect, e2eUserId, e2eWallId, e2eSlotId } from './fixtures';
import { createPrivateS3Storage } from '../packages/integrations/src/private-s3';
import { isolatedE2EEnvironment } from './environment';
const api = process.env.API_PUBLIC_ORIGIN ?? 'http://127.0.0.1:4000';
test('paid checkout: trusted PG terms, keyboard, stale confirmation, double submit, response loss and reload', async ({
  scenario,
}, testInfo) => {
  const context = await scenario.actorContext(e2eUserId);
  const page = await context.newPage();
  const db = scenario.database.pool;
  const config = (
    await db.query(
      `INSERT INTO pricing_config_versions(algorithm_version,currency,base_amount_minor,minimum_amount_minor,maximum_amount_minor,dynamic_takeover_limit,takeover_step_size,step_amount_minor,decay_interval_seconds,decay_amount_minor,decay_floor_amount_minor,guaranteed_visibility_seconds,created_by_user_id) VALUES('takeover_ladder_v1','RUB',65000,10000,100000,3,1,1000,60,100,10000,60,$1) RETURNING id`,
      [scenario.ownerId],
    )
  ).rows[0].id;
  await db.query('UPDATE walls SET pricing_config_id=$2 WHERE id=$1', [
    e2eWallId,
    config,
  ]);
  await db.query(
    "INSERT INTO placements(slot_id,user_id,source,started_at) VALUES($1,$2,'free_claim',now()-interval '1 hour')",
    [e2eSlotId, scenario.ownerId],
  );
  const autographId = randomUUID(),
    assetId = randomUUID();
  await db.query(
    "INSERT INTO autographs(id,user_id,source,status) VALUES($1,$2,'canvas','ready')",
    [autographId, e2eUserId],
  );
  // A synthetic geometric drawing, never a real person's signature or photo.
  const bytes = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="160"><rect width="480" height="160" fill="white"/><path d="M30 100 Q80 20 120 100 T210 80 Q260 30 300 100 T430 60 M50 125 L420 125" fill="none" stroke="black" stroke-width="6"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  const key = `autographs/${autographId}/cleaned/fixture.png`;
  await createPrivateS3Storage(
    isolatedE2EEnvironment().storage,
  ).putPrivateObject(key, bytes);
  await db.query(
    "INSERT INTO autograph_assets(id,autograph_id,role,status,storage_key,actual_content_type,verified_size_bytes,width,height,uploaded_at) VALUES($1,$2,'cleaned','uploaded',$3,'image/png',$4,480,160,now())",
    [assetId, autographId, key, bytes.length],
  );
  const approval = (
    await db.query(
      'INSERT INTO autograph_user_approvals(autograph_id,user_id,cleaned_asset_id) VALUES($1,$2,$3) RETURNING id',
      [autographId, e2eUserId, assetId],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO autograph_moderation_decisions(autograph_id,moderator_user_id,user_approval_id,cleaned_asset_id,decision) VALUES($1,$2,$3,$4,'approved')",
    [autographId, scenario.ownerId, approval, assetId],
  );
  const headers = { origin: process.env.WEB_ORIGIN ?? 'http://127.0.0.1:3000' };
  const quote = await context.request.post(
    `${api}/walls/${e2eWallId}/slots/${e2eSlotId}/takeover-quote`,
    { headers, data: {} },
  );
  expect(quote.status()).toBe(201);
  const reservation = await context.request.post(
    `${api}/takeover-reservations`,
    {
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      data: { quoteId: (await quote.json()).id },
    },
  );
  expect(reservation.status()).toBe(201);
  const reservationId = (await reservation.json()).id;
  const url = `/payments/checkout?reservationId=${reservationId}&autographId=${autographId}`;
  let stale = true;
  await page.route(`${api}/payments/checkout?**`, async (route) => {
    const r = await route.fetch();
    const body = await r.json();
    if (stale && body.documents)
      body.documents = body.documents.map(
        (d: { type: string; version: string }) =>
          d.type === 'public_offer' ? { ...d, version: 'test-v0' } : d,
      );
    await route.fulfill({ response: r, json: body });
  });
  // A legitimate archived synthetic edition can be read, but cannot admit a new Order.
  await page.goto(url);
  const checkout = page.getByRole('region', { name: 'Условия вашего заказа' });
  const oldChoice = page.getByRole('checkbox');
  await oldChoice.check();
  const oldSubmit = page.getByRole('button', {
    name: 'Подтвердить заказ и перейти к оплате',
  });
  await expect(oldSubmit).toBeEnabled();
  await oldSubmit.click();
  await expect(checkout.getByRole('alert')).toContainText(
    'Условия заказа изменились',
  );
  expect((await db.query('SELECT 1 FROM payment_orders')).rowCount).toBe(0);
  stale = false;
  await page
    .getByRole('button', { name: 'Повторить проверку условий' })
    .click();
  const checkbox = page.getByRole('checkbox');
  await expect(checkbox).not.toBeChecked();
  const submit = page.getByRole('button', {
    name: 'Подтвердить заказ и перейти к оплате',
  });
  await expect(submit).toBeDisabled();
  await expect(
    page.getByRole('link', { name: /Публичная оферта — редакция test-v1/ }),
  ).toHaveAttribute('href', '/legal/offer/versions/test-v1');
  const offerLink = page.getByRole('link', {
    name: /Публичная оферта — редакция test-v1/,
  });
  await offerLink.focus();
  const popupWait = page.waitForEvent('popup');
  await page.keyboard.press('Enter');
  const popup = await popupWait;
  await expect(
    popup.getByRole('heading', { name: 'Публичная оферта', exact: true }),
  ).toBeVisible();
  await popup.close();
  await expect(checkbox).not.toBeChecked();
  for (const width of [1440, 1024, 390, 320])
    for (const scale of [100, 200]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(
        (s) =>
          (document.documentElement.style.fontSize = `${(16 * s) / 100}px`),
        scale,
      );
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`checkout-${width}-${scale}.png`),
        fullPage: true,
      });
    }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.evaluate(() => (document.documentElement.style.fontSize = '16px'));
  await checkbox.focus();
  await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
  await expect(submit).toBeEnabled();
  let lost = true;
  let requests = 0;
  await page.route(`${api}/payments/orders`, async (route) => {
    requests++;
    const r = await route.fetch();
    expect(r.status()).toBe(200);
    if (lost) {
      lost = false;
      await route.abort('failed');
    } else await route.fulfill({ response: r });
  });
  await page.keyboard.press('Tab');
  await expect(submit).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(checkout.getByRole('alert')).toContainText(
    'Состояние заказа уточняется',
  );
  await submit.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('link', { name: 'Перейти к оплате в ЮKassa' }),
  ).toHaveAttribute(
    'href',
    'https://yoomoney.ru/api-pages/v2/payment-confirm/epl?synthetic=1',
  );
  expect(requests).toBe(2);
  const snapshot = (
    await db.query('SELECT row_to_json(c) AS c FROM checkout_confirmations c')
  ).rows;
  expect(snapshot).toHaveLength(1);
  expect(snapshot[0].c.user_id).toBe(e2eUserId);
  await page.reload();
  await expect(
    page.getByRole('link', { name: 'Проверить состояние заказа' }),
  ).toBeVisible();
  const recoveredPayment = page.getByRole('link', {
    name: 'Перейти к оплате в ЮKassa',
  });
  await expect(recoveredPayment).toHaveAttribute(
    'href',
    'https://yoomoney.ru/api-pages/v2/payment-confirm/epl?synthetic=1',
  );
  await page
    .getByRole('button', { name: 'Повторить проверку условий' })
    .click();
  await expect(recoveredPayment).toHaveAttribute(
    'href',
    'https://yoomoney.ru/api-pages/v2/payment-confirm/epl?synthetic=1',
  );
  expect(requests).toBe(2);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  expect(
    (await db.query('SELECT row_to_json(c) AS c FROM checkout_confirmations c'))
      .rows,
  ).toEqual(snapshot);
  await page.getByRole('link', { name: 'Проверить состояние заказа' }).click();
  await expect(page.getByRole('status')).toHaveText('Payment is pending.');
});
