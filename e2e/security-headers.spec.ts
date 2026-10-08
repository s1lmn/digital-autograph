import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const webUrl = process.env.E2E_WEB_URL ?? 'http://127.0.0.1:3000';
const apiUrl = process.env.API_PUBLIC_ORIGIN ?? 'http://127.0.0.1:4000';
const policy = "frame-ancestors 'none'; object-src 'none'; base-uri 'self'";

test('web and API HTTP responses carry the baseline security policy', async ({
  request,
}) => {
  for (const [url, status, referrer] of [
    [webUrl, 200, 'strict-origin-when-cross-origin'],
    [`${webUrl}/autograph/create`, 200, 'strict-origin-when-cross-origin'],
    [`${webUrl}/does-not-exist`, 404, 'strict-origin-when-cross-origin'],
    [`${apiUrl}/health/live`, 200, 'no-referrer'],
    [`${apiUrl}/auth/me`, 401, 'no-referrer'],
  ] as const) {
    const response = await request.get(url);
    expect(response.status()).toBe(status);
    expect(response.headers()['content-security-policy']).toBe(policy);
    expect(response.headers()['x-frame-options']).toBe('DENY');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(response.headers()['referrer-policy']).toBe(referrer);
    if (url.startsWith(webUrl)) {
      expect(response.headers()['x-powered-by']).toBeUndefined();
    }
    if (url === webUrl) {
      const script = (await response.text()).match(/<script[^>]+src="([^"]+)"/);
      expect(script).not.toBeNull();
      const asset = await request.get(new URL(script![1]!, webUrl).toString());
      expect(asset.status()).toBe(200);
      expect(asset.headers()['x-content-type-options']).toBe('nosniff');
      expect(asset.headers()['content-security-policy']).toBe(policy);
    }
  }
});

for (const sameOrigin of [true, false]) {
  test(`browser rejects ${sameOrigin ? 'same-origin' : 'cross-origin'} framing`, async ({
    page,
  }) => {
    const body = `<html><body><iframe src="${webUrl}/"></iframe></body></html>`;
    // A real loopback response gives Chromium the correct network address
    // space. A fulfilled foreign request can fail Private Network Access
    // before reaching the framed document's response policy.
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(body);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    try {
      const host = sameOrigin
        ? `${webUrl}/embedding-host`
        : `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
      if (sameOrigin) {
        await page.route(host, (route) =>
          route.fulfill({ contentType: 'text/html', body }),
        );
      }
      const refusal = page.waitForEvent('requestfailed', {
        predicate: (request) =>
          request.isNavigationRequest() && request.url() === `${webUrl}/`,
      });
      await page.goto(host);
      expect((await refusal).failure()?.errorText).toBe(
        'net::ERR_BLOCKED_BY_RESPONSE',
      );
      await expect(
        page.frameLocator('iframe').getByRole('heading', {
          name: 'Leave your mark on a creator’s Wall',
        }),
      ).toHaveCount(0);
      await page.goto(webUrl);
      await expect(
        page.getByRole('heading', {
          name: 'Leave your mark on a creator’s Wall',
        }),
      ).toBeVisible();
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
}
