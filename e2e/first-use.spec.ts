import { test, expect, e2eUserId, e2eWallId } from './fixtures';
import { SessionService } from '../packages/auth/src/index';
import { createPgSessionRepository } from '../packages/db/src/index';
const api = process.env.API_PUBLIC_ORIGIN ?? 'http://127.0.0.1:4000';
test('synthetic published first-use: keyboard/mobile, stale edition, retry, reload and new tab', async ({
  page,
  scenario,
}, testInfo) => {
  const session = await new SessionService(
    createPgSessionRepository(scenario.database.pool),
    1209600,
  ).createSession(e2eUserId);
  await page.context().addCookies([
    {
      name: 'da_session',
      value: session.token,
      url: api,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  let stale = true;
  await page.route(`${api}/legal/accept`, async (route) => {
    stale = false;
    await route.continue();
  });
  await page.route(`${api}/legal/first-use`, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (stale) {
      body.documents = body.documents.map(
        (d: { type: string; version: string; path: string }) =>
          d.type === 'terms_of_use'
            ? {
                ...d,
                version: 'test-v0',
                path: '/legal/documents/terms_of_use/test-v0',
              }
            : d,
      );
    }
    await route.fulfill({ response, json: body });
  });
  await page.goto(`/legal/first-use?returnTo=/walls/${e2eWallId}`);
  const heading = page.getByRole('heading', { name: 'Перед первым действием' });
  await expect(heading).toBeFocused();
  await expect(
    page.getByRole('link', {
      name: /Пользовательское соглашение — редакция test-v0/,
    }),
  ).toBeVisible();
  await expect(heading.locator('..')).toHaveAttribute('lang', 'ru');
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
        path: testInfo.outputPath(`first-use-${width}-${scale}.png`),
        fullPage: true,
      });
    }
  await page.evaluate(() => (document.documentElement.style.fontSize = '16px'));
  for (const checkbox of await page.getByRole('checkbox').all()) {
    await checkbox.focus();
    await page.keyboard.press('Space');
  }
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Перед первым действием' })
      .getByRole('alert'),
  ).toContainText('Редакция документа изменилась');
  await expect(
    page.getByRole('link', {
      name: /Пользовательское соглашение — редакция test-v1/,
    }),
  ).toBeVisible();
  for (const checkbox of await page.getByRole('checkbox').all()) {
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
  }
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.getByText('Можно продолжить работу.')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Вернуться к действию' }),
  ).toHaveAttribute('href', `/walls/${e2eWallId}`);
  await page.reload();
  await expect(page.getByText('Можно продолжить работу.')).toBeVisible();
  const second = await page.context().newPage();
  await second.goto('/autograph/create');
  await expect(
    second.getByRole('heading', { name: 'Draw your autograph' }),
  ).toBeVisible();
  await expect(
    second.getByRole('checkbox', { name: 'Мне исполнилось 18 лет.' }),
  ).toHaveCount(0);
  const counts = await scenario.database.pool.query(
    'SELECT (SELECT count(*) FROM age_declarations WHERE user_id=$1)::int AS age,(SELECT count(*) FROM legal_evidence_events WHERE user_id=$1)::int AS events',
    [e2eUserId],
  );
  expect(counts.rows[0]).toEqual({ age: 1, events: 2 });
  await second.close();
});
