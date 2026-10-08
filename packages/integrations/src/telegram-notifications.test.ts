import { describe, it, expect, vi } from 'vitest';
import { createTelegramNotificationSender } from './telegram-notifications';
describe('Telegram delivery outcomes', () => {
  it('uses plain text, fixed HTTPS endpoint, no redirects and no credentials in the body', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })),
      );
    expect(
      await createTelegramNotificationSender('synthetic-token', request).send(
        '123',
        '<hello>',
      ),
    ).toEqual({ state: 'sent' });
    const [url, options] = request.mock.calls[0]!;
    expect(url).toBe('https://api.telegram.org/botsynthetic-token/sendMessage');
    expect(options?.redirect).toBe('error');
    expect(JSON.parse(options!.body as string)).toEqual({
      chat_id: '123',
      text: '<hello>',
      link_preview_options: { is_disabled: true },
    });
  });
  it('only retries an explicit rejected 429, not transport ambiguity or 5xx', async () => {
    const request = vi.fn<typeof fetch>();
    const sender = createTelegramNotificationSender('synthetic', request);
    request.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          error_code: 429,
          parameters: { retry_after: 8 },
        }),
        { status: 429 },
      ),
    );
    expect(await sender.send('1', 'text')).toEqual({
      state: 'retry',
      retryAfterSeconds: 8,
    });
    request.mockRejectedValueOnce(new Error('private token'));
    expect(await sender.send('1', 'text')).toEqual({ state: 'uncertain' });
    request.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    expect(await sender.send('1', 'text')).toEqual({ state: 'uncertain' });
    request.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error_code: 403 }), {
        status: 403,
      }),
    );
    expect(await sender.send('1', 'text')).toEqual({ state: 'failed' });
  });
  it('bounds oversized/malformed responses', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('a'.repeat(65537)))
      .mockResolvedValueOnce(new Response('not JSON'));
    const sender = createTelegramNotificationSender('synthetic', request);
    expect(await sender.send('1', 'text')).toEqual({ state: 'uncertain' });
    expect(await sender.send('1', 'text')).toEqual({ state: 'uncertain' });
  });
});
