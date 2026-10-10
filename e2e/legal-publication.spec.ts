import { expect, test } from '@playwright/test';
const api = process.env.API_PUBLIC_ORIGIN ?? 'http://127.0.0.1:4000';
test('real draft registry is unavailable to SSR, crawlers, direct versions and archives', async ({
  page,
  request,
}) => {
  for (const path of ['/legal/documents', '/security/documents'])
    expect(await (await request.get(`${api}${path}`)).json()).toEqual({
      documents: [],
    });
  const index = await page.goto('/legal');
  expect(index?.status()).toBe(200);
  await expect(
    page.getByText('Опубликованных документов пока нет.'),
  ).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    /noindex/,
  );
  for (const path of [
    '/legal/terms',
    '/legal/terms/versions/1.0-destka-20261010',
    '/legal/terms/versions/unknown',
    '/legal/terms/archive',
    '/security',
    '/security/archive',
    '/security/versions/1.0-destka-20261010',
    '/legal/privacy-data-map',
    '/sitemap.xml',
    '/.well-known/security.txt',
  ]) {
    const response = await request.get(path);
    expect(response.status()).toBe(404);
    const html = await response.text();
    expect(html).not.toContain('Лошкарев');
    expect(html).not.toContain('[[URL');
    expect(html).not.toContain('loshkarv00');
  }
  await expect(page.locator('footer a')).toHaveAttribute('href', '/legal');
  await expect(
    page.getByRole('link', {
      name: 'Пользовательское соглашение',
      exact: true,
    }),
  ).toHaveCount(0);
});
