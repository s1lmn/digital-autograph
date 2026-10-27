import { expect, test } from '@playwright/test';
const api = process.env.API_PUBLIC_ORIGIN ?? 'http://127.0.0.1:4000';
test('real draft identities stay unavailable alongside synthetic published E2E documents', async ({
  page,
  request,
}) => {
  for (const path of ['/legal/documents', '/security/documents']) {
    const result = await (await request.get(`${api}${path}`)).json();
    expect(
      result.documents.every((d: { version: string }) =>
        ['test-v1', 'test-v0'].includes(d.version),
      ),
    ).toBe(true);
  }
  const index = await page.goto('/legal');
  expect(index?.status()).toBe(200);
  await expect(
    page.getByRole('heading', { name: 'Юридические документы' }),
  ).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    /noindex/,
  );
  for (const path of [
    '/legal/terms/versions/1.0-destka-20261010',
    '/legal/terms/versions/unknown',
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
  await expect(page.locator('footer nav a')).toHaveAttribute('href', '/legal');
  await expect(
    page.getByRole('link', {
      name: 'Пользовательское соглашение',
      exact: true,
    }),
  ).toHaveCount(1);
});
