import { e2eUserId, expect, test } from './fixtures';

test.use({ uiLocale: 'ru' });

test('Destka language and theme persist while an unfinished autograph survives switching', async ({
  page,
  scenario,
}) => {
  await page.context().clearCookies({ name: 'destka-locale' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Твой автограф.Часть их мира.',
  );
  await expect(page).toHaveTitle('Destka');
  await page.goto('/me/settings');
  await page
    .getByRole('combobox', { name: 'Цветовая тема' })
    .selectOption('dark');
  await page
    .getByRole('combobox', { name: 'Язык интерфейса' })
    .selectOption('en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(
    page.getByRole('combobox', { name: 'Interface language' }),
  ).toHaveValue('en');
  await expect(page.getByRole('combobox', { name: 'Color theme' })).toHaveValue(
    'dark',
  );

  const actor = await scenario.actorContext(e2eUserId);
  const editor = await actor.newPage();
  const web = process.env.E2E_WEB_URL ?? 'http://127.0.0.1:3000';
  await editor.goto(`${web}/autograph/create`);
  const canvas = editor.getByLabel('Область рисования автографа');
  await expect(canvas).toBeVisible();
  await canvas.focus();
  await editor.keyboard.press('Space');
  await editor.keyboard.press('ArrowRight');
  await editor.keyboard.press('ArrowDown');
  await editor.keyboard.press('Space');
  const pixels = await canvas.evaluate((element: HTMLCanvasElement) =>
    element.toDataURL(),
  );
  await expect(
    editor.getByRole('button', { name: 'Создать приватный предпросмотр' }),
  ).toBeEnabled();
  // Preferences live in their own tab; the in-progress canvas is not navigated away.
  const preferences = await actor.newPage();
  await preferences.goto(`${web}/me/settings`);
  await preferences
    .getByRole('combobox', { name: 'Язык интерфейса' })
    .selectOption('en');
  await expect(preferences.getByRole('heading', { level: 1 })).toHaveText(
    'Settings',
  );
  await expect(
    editor.getByRole('button', { name: 'Создать приватный предпросмотр' }),
  ).toBeEnabled();
  await expect
    .poll(() =>
      canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL()),
    )
    .toBe(pixels);
  const second = await actor.newPage();
  await second.goto(`${web}/me`);
  await expect(second.locator('html')).toHaveAttribute('lang', 'en');
  await expect(second).toHaveTitle('Your account | Destka');
  // Language preference has no authority to mutate or publish an autograph.
  const records = await scenario.database.pool.query(
    'SELECT count(*)::int AS count FROM autographs',
  );
  expect(records.rows[0]).toEqual({ count: 0 });
});
