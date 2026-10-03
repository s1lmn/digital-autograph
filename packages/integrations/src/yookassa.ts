import {
  PaymentError,
  decimalToMinor,
  fingerprint,
  requestBody,
  type PaymentObservation,
  type PaymentProvider,
} from '@digital-autograph/payments';

const endpoint = 'https://api.yookassa.ru/v3/payments';
const paymentId =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new PaymentError('MALFORMED_PROVIDER_RESPONSE');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 256)
    throw new PaymentError('MALFORMED_PROVIDER_RESPONSE');
  return value;
}
export function parseYookassaPayment(value: unknown): PaymentObservation {
  const p = record(value),
    amount = record(p.amount),
    recipient = record(p.recipient),
    metadata = record(p.metadata);
  const id = text(p.id),
    orderId = text(metadata.order_id);
  if (
    !paymentId.test(id) ||
    !paymentId.test(orderId) ||
    typeof p.test !== 'boolean' ||
    typeof p.paid !== 'boolean'
  )
    throw new PaymentError('MALFORMED_PROVIDER_RESPONSE');
  let confirmationUrl: string | null = null;
  if (p.confirmation) {
    const confirmation = record(p.confirmation);
    if (
      confirmation.type !== 'redirect' ||
      typeof confirmation.confirmation_url !== 'string' ||
      confirmation.confirmation_url.length > 2048
    )
      throw new PaymentError('INVALID_CONFIRMATION_URL');
    const url = new URL(confirmation.confirmation_url);
    if (
      url.origin !== 'https://yoomoney.ru' ||
      !url.pathname.startsWith('/checkout/payments/') ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new PaymentError('INVALID_CONFIRMATION_URL');
    confirmationUrl = url.href;
  }
  return {
    id,
    orderId,
    shopId: text(recipient.account_id),
    test: p.test,
    paid: p.paid,
    rawStatus: text(p.status),
    amountMinor: decimalToMinor(text(amount.value)),
    currency: text(amount.currency),
    confirmationUrl,
  };
}
export function createYookassaProvider(
  config: { shopId: string; secretKey: string },
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): PaymentProvider {
  const transport = options.fetch ?? fetch;
  const authorization = `Basic ${Buffer.from(`${config.shopId}:${config.secretKey}`).toString('base64')}`;
  async function request(url: string, body?: string, key?: string) {
    try {
      const response = await transport(url, {
        method: body ? 'POST' : 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        headers: {
          Authorization: authorization,
          ...(body
            ? { 'Content-Type': 'application/json', 'Idempotence-Key': key! }
            : {}),
        },
        ...(body ? { body } : {}),
      });
      if (response.status !== 200) {
        await response.body?.cancel();
        throw new PaymentError(
          response.status >= 500 || response.status === 429
            ? 'PROVIDER_OUTCOME_UNKNOWN'
            : 'PROVIDER_REJECTED',
        );
      }
      const reader = response.body?.getReader();
      if (!reader) throw new PaymentError('MALFORMED_PROVIDER_RESPONSE');
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 65536) {
          await reader.cancel();
          throw new PaymentError('PROVIDER_RESPONSE_TOO_LARGE');
        }
        chunks.push(value);
      }
      return parseYookassaPayment(
        JSON.parse(Buffer.concat(chunks).toString('utf8')),
      );
    } catch (error) {
      // Never propagate fetch errors, URLs, provider bodies or authentication material.
      if (error instanceof PaymentError) throw error;
      throw new PaymentError('PROVIDER_OUTCOME_UNKNOWN');
    }
  }
  return {
    createPayment(input, key, expectedFingerprint) {
      if (!paymentId.test(key) || fingerprint(input) !== expectedFingerprint)
        throw new PaymentError('REQUEST_FINGERPRINT_MISMATCH');
      return request(endpoint, requestBody(input), key);
    },
    getPayment(id) {
      if (!paymentId.test(id))
        throw new PaymentError('INVALID_PROVIDER_PAYMENT_ID');
      return request(`${endpoint}/${id}`);
    },
  };
}
