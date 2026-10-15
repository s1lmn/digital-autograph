// In-memory, sandbox-shaped provider. No real credentials or external requests.
import { randomUUID } from 'node:crypto';
import type {
  PaymentProvider,
  PaymentObservation,
} from '../packages/payments/src/index';
const byKey = new Map<string, PaymentObservation>();
export const syntheticPayment = {
  settings: {
    shopId: '123',
    mode: 'sandbox' as const,
    returnUrl: `${process.env.WEB_ORIGIN}/payments/return`,
    creatorShareBps: 5000,
  },
  provider: {
    async createPayment(p, key) {
      if (!byKey.has(key))
        byKey.set(key, {
          id: randomUUID(),
          orderId: p.orderId,
          shopId: '123',
          test: true,
          amountMinor: p.amountMinor,
          currency: p.currency,
          rawStatus: 'pending',
          paid: false,
          confirmationUrl:
            'https://yoomoney.ru/api-pages/v2/payment-confirm/epl?synthetic=1',
        });
      return byKey.get(key)!;
    },
    async getPayment(id) {
      const r = [...byKey.values()].find((p) => p.id === id);
      if (!r) throw new Error('Unknown synthetic payment');
      return { ...r };
    },
  } satisfies PaymentProvider,
};
