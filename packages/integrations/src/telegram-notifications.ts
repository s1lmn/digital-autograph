import type {
  TelegramSender,
  SendResult,
} from '@digital-autograph/notifications';

export function createTelegramNotificationSender(
  token: string,
  request: typeof fetch = fetch,
): TelegramSender {
  return {
    async send(chatId, text): Promise<SendResult> {
      try {
        const response = await request(
          `https://api.telegram.org/bot${token}/sendMessage`,
          {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(10000),
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text,
              link_preview_options: { is_disabled: true },
            }),
          },
        );
        // A truncated/malformed result or 5xx can follow an accepted send.
        // Do not leak the URL/token, response, chat identifier or text to logs.
        const reader = response.body?.getReader();
        if (!reader) return { state: 'uncertain' };
        let size = 0;
        const chunks: Uint8Array[] = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 65536) {
            await reader.cancel();
            return { state: 'uncertain' };
          }
          chunks.push(value);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          ok?: boolean;
          error_code?: number;
          parameters?: { retry_after?: number };
        };
        if (response.ok && body.ok === true) return { state: 'sent' };
        if (
          response.status === 429 &&
          body.ok === false &&
          body.error_code === 429
        ) {
          const delay = body.parameters?.retry_after;
          return {
            state: 'retry',
            retryAfterSeconds:
              typeof delay === 'number' && Number.isFinite(delay)
                ? Math.max(1, Math.min(86400, delay))
                : 60,
          };
        }
        if ([400, 401, 403].includes(response.status) && body.ok === false)
          return { state: 'failed' };
        return { state: 'uncertain' };
      } catch {
        return { state: 'uncertain' };
      }
    },
  };
}
