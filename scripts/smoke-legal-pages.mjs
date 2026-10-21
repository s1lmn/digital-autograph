import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cp, readdir, readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import process from 'node:process';

// This isolated HTTP fixture cannot toggle any application/source readiness flag.
// Run after pnpm build. No real documents, users, provider requests or credentials.
const standalone = resolve('apps/web/.next/standalone/apps/web');
await cp('apps/web/.next/static', `${standalone}/.next/static`, {
  recursive: true,
});
const oldText =
  'СИНТЕТИЧЕСКАЯ АРХИВНАЯ РЕДАКЦИЯ\n\n1. Исторический текст остаётся неизменным.\n2. https://example.test/' +
  'long-path/'.repeat(40) +
  '\n3. <script>не исполняется</script>\n';
const newText =
  'СИНТЕТИЧЕСКАЯ ТЕКУЩАЯ РЕДАКЦИЯ\n\n1. Только тестовые данные.\n';
const securityText =
  'СИНТЕТИЧЕСКАЯ SECURITY POLICY\n\n1. Отдельно от согласий и Заказов.\n';
const publication = (type, version, current, text) => ({
  type,
  version,
  current,
  hash: createHash('sha256').update(text).digest('hex'),
  path:
    type === 'security'
      ? `/security/documents/${version}`
      : `/legal/documents/${type}/${version}`,
});
const old = publication('terms_of_use', 'fixture-old', false, oldText);
const current = publication('terms_of_use', 'fixture-current', true, newText);
const security = publication(
  'security',
  'fixture-security',
  true,
  securityText,
);
let phase = 'draft';
const backend = createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (phase === 'offline') {
    res.writeHead(503);
    res.end();
    return;
  }
  const list =
    phase === 'draft'
      ? []
      : phase === 'history-only'
        ? [old, security]
        : [old, current, security];
  if (req.url === '/legal/documents' || req.url === '/security/documents') {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        documents: list.filter(
          (d) => (d.type === 'security') === req.url.startsWith('/security/'),
        ),
      }),
    );
    return;
  }
  const doc = list.find((d) => d.path === req.url);
  if (!doc) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('X-Legal-Document-Status', 'published');
  res.end(
    phase === 'tampered'
      ? 'UNAPPROVED FIXTURE [[URL]]'
      : doc === old
        ? oldText
        : doc === current
          ? newText
          : securityText,
  );
});
await new Promise((done) => backend.listen(0, '127.0.0.1', done));
const apiOrigin = `http://127.0.0.1:${backend.address().port}`;
// Reserve an available loopback web port, then release it for Next.
const reserve = createServer();
await new Promise((done) => reserve.listen(0, '127.0.0.1', done));
const port = reserve.address().port;
await new Promise((done) => reserve.close(done));
const origin = `http://127.0.0.1:${port}`;
const web = spawn(process.execPath, [`${standalone}/server.js`], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
    APP_ENV: 'test',
    HOSTNAME: '127.0.0.1',
    PORT: String(port),
    API_INTERNAL_URL: apiOrigin,
    API_PUBLIC_ORIGIN: apiOrigin,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
web.stdout.resume();
web.stderr.resume();
const request = async (path) => {
  const response = await globalThis.fetch(`${origin}${path}`, {
    redirect: 'manual',
    signal: globalThis.AbortSignal.timeout(10000),
  });
  return {
    status: response.status,
    text: await response.text(),
    headers: response.headers,
  };
};
const hidden = (html) => {
  assert(!html.includes('СИНТЕТИЧЕСКАЯ'));
  assert(!html.includes('UNAPPROVED FIXTURE'));
};
let browser;
try {
  for (let i = 0; i < 100; i++) {
    if (web.exitCode !== null) throw new Error('Standalone web exited');
    try {
      if ((await request('/legal')).status === 200) break;
    } catch {
      /* Wait for local startup. */
    }
    if (i === 99) throw new Error('Standalone web did not start');
    await delay(100);
  }
  for (const path of [
    '/legal/terms',
    '/legal/terms/versions/fixture-old',
    '/legal/terms/archive',
    '/security',
    '/security/versions/fixture-security',
    '/security/archive',
    '/legal/internal',
    '/sitemap.xml',
    '/.well-known/security.txt',
  ]) {
    const response = await request(path);
    assert.equal(response.status, 404, path);
    hidden(response.text);
  }
  const index = await request('/legal');
  assert(index.text.includes('Опубликованных документов пока нет.'));
  assert(index.text.includes('noindex'));
  phase = 'published';
  for (const [path, expected] of [
    ['/legal/terms', newText],
    ['/legal/terms/versions/fixture-old', oldText],
    ['/security', securityText],
    ['/security/versions/fixture-security', securityText],
  ]) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    assert(response.text.includes(expected.split('\n')[0]));
    assert(response.text.includes('noindex'));
    assert(response.text.includes('lang="ru"'));
    assert(!response.text.includes('<script>не исполняется</script>'));
  }
  assert.equal((await request('/legal/terms/versions/unknown')).status, 404);
  phase = 'history-only';
  assert.equal((await request('/legal/terms')).status, 404);
  assert(
    (await request('/legal/terms/archive')).text.includes(
      '/legal/terms/versions/fixture-old',
    ),
  );
  assert((await request('/legal')).text.includes('/legal/terms/archive'));
  assert(
    (await request('/legal/terms/versions/fixture-old')).text.includes(
      oldText.split('\n')[0],
    ),
  );
  phase = 'offline';
  const offline = await request('/legal/terms/versions/fixture-old');
  hidden(offline.text);
  assert(offline.text.includes('Документы временно недоступны'));
  assert(offline.text.includes('noindex'));
  phase = 'tampered';
  const tampered = await request('/legal/terms/versions/fixture-old');
  hidden(tampered.text);
  assert(tampered.text.includes('Документы временно недоступны'));
  const walk = async (folder) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = `${folder}/${entry.name}`;
      assert(
        !path.includes('/docs/legal/'),
        'Legal sources must not enter the web runtime',
      );
      if (entry.isDirectory()) await walk(path);
      else
        assert(!/\.docx$/i.test(path), 'DOCX must not enter the web runtime');
    }
  };
  await walk('apps/web/.next/standalone');
  for (const file of await readdir('apps/web/.next/static/chunks')) {
    if (file.endsWith('.js'))
      assert(
        !(
          await readFile(`apps/web/.next/static/chunks/${file}`, 'utf8')
        ).includes('Лошкарев Егор'),
        'Canonical legal text must not enter the client bundle',
      );
  }
  process.stdout.write(
    'Legal SSR smoke PASS: drafts/unknown/internal 404; current/history/security; outage/tampering; noindex; no source files in runtime.\n',
  );
  if (process.argv.includes('--visual')) {
    const { chromium } = await import('@playwright/test');
    browser = await chromium.launch();
    const page = await browser.newPage();
    phase = 'published';
    const out = process.env.LEGAL_SMOKE_SCREENSHOTS;
    if (out) await mkdir(out, { recursive: true });
    for (const width of [1440, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${origin}/legal/terms/versions/fixture-old`);
      assert.equal(
        await page
          .getByRole('region', { name: 'Текст документа' })
          .textContent(),
        oldText,
      );
      for (const scale of [1, 2]) {
        await page.evaluate((scale) => {
          globalThis.document.documentElement.style.fontSize = `${16 * scale}px`;
        }, scale);
        assert(
          await page.evaluate(
            () =>
              globalThis.document.documentElement.scrollWidth <=
              globalThis.innerWidth,
          ),
          `Horizontal overflow at ${width}px / ${scale * 100}%`,
        );
        if (out)
          await page.screenshot({
            path: `${out}/legal-${width}-${scale * 100}.png`,
            fullPage: true,
          });
      }
    }
    await page.goto(`${origin}/legal/terms/versions/fixture-old`);
    await page.keyboard.press('Tab');
    assert.equal(await page.locator(':focus').textContent(), 'Skip to content');
    await page.keyboard.press('Enter');
    assert.equal(
      await page.locator(':focus').getAttribute('id'),
      'main-content',
    );
    await page.keyboard.press('Tab');
    assert.equal(
      await page.locator(':focus').textContent(),
      'Копировать ссылку на редакцию',
    );
    assert.equal(
      await page
        .locator(':focus')
        .evaluate((el) => globalThis.getComputedStyle(el).outlineStyle),
      'solid',
    );
    await page.keyboard.press('Enter');
    await page
      .locator('[aria-live="polite"]')
      .filter({ hasText: /Ссылка скопирована|Не удалось скопировать/ })
      .waitFor();
    assert.equal(await page.locator('main h1').count(), 1);
    assert.equal(await page.locator('main').getAttribute('lang'), 'ru');
    process.stdout.write(
      'Responsive/keyboard PASS: 1440/1024/390/320px, 100/200% text, long URLs, exact text, focus/skip link/copy, Russian language.\n',
    );
  }
} finally {
  if (browser) await browser.close();
  web.kill('SIGTERM');
  await new Promise((done) =>
    web.exitCode !== null ? done() : web.once('exit', done),
  );
  await new Promise((done) => backend.close(done));
}
