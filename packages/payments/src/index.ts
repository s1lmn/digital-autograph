import { createHash } from 'node:crypto';
import type {
  CheckoutConfirmation,
  CheckoutSummary,
} from '@digital-autograph/domain';

export const paymentStates = [
  'created',
  'provider_pending',
  'unknown',
  'succeeded',
  'canceled',
  'paid_but_not_fulfilled',
  'fulfilled',
] as const;
export type PaymentState = (typeof paymentStates)[number];
export class PaymentError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export function minorToDecimal(value: string): string {
  if (!/^[1-9][0-9]{0,11}$/.test(value) || BigInt(value) > 100000000000n)
    throw new PaymentError('INVALID_AMOUNT');
  const amount = BigInt(value);
  return `${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`;
}
export function decimalToMinor(value: string): string {
  if (!/^(0|[1-9][0-9]{0,9})\.[0-9]{2}$/.test(value))
    throw new PaymentError('INVALID_AMOUNT');
  const [whole, fraction] = value.split('.');
  const minor = (BigInt(whole!) * 100n + BigInt(fraction!)).toString();
  minorToDecimal(minor);
  return minor;
}
export function normalizePaymentStatus(
  raw: string,
  paid: boolean,
): PaymentState {
  if (raw === 'succeeded' && paid) return 'succeeded';
  if (raw === 'pending' || raw === 'waiting_for_capture')
    return 'provider_pending';
  if (raw === 'canceled' && !paid) return 'canceled';
  return 'unknown';
}
export function canTransition(from: PaymentState, to: PaymentState): boolean {
  if (from === to) return true;
  if (from === 'fulfilled' || from === 'paid_but_not_fulfilled') return false;
  if (from === 'succeeded')
    return ['fulfilled', 'paid_but_not_fulfilled'].includes(to);
  if (from === 'canceled') return to === 'paid_but_not_fulfilled';
  return to !== 'created';
}
export type PaymentRequest = {
  orderId: string;
  amountMinor: string;
  currency: 'RUB';
  returnUrl: string;
};
// Stable, versioned serialization; persisted before the first network operation.
export function requestBody(input: PaymentRequest): string {
  return JSON.stringify({
    amount: {
      value: minorToDecimal(input.amountMinor),
      currency: input.currency,
    },
    capture: true,
    confirmation: { type: 'redirect', return_url: input.returnUrl },
    metadata: { order_id: input.orderId },
  });
}
export function fingerprint(input: PaymentRequest): string {
  return createHash('sha256').update(requestBody(input)).digest('hex');
}
export type PaymentObservation = {
  id: string;
  orderId: string;
  shopId: string;
  test: boolean;
  amountMinor: string;
  currency: string;
  rawStatus: string;
  paid: boolean;
  confirmationUrl: string | null;
};
export interface PaymentProvider {
  createPayment(
    request: PaymentRequest,
    key: string,
    expectedFingerprint: string,
  ): Promise<PaymentObservation>;
  getPayment(id: string): Promise<PaymentObservation>;
}
export type PaymentAttempt = PaymentRequest & {
  id: string;
  userId: string;
  autographId: string;
  reservationId: string;
  shopId: string;
  mode: 'sandbox' | 'live';
  operationKey: string;
  requestFingerprint: string;
  providerPaymentId: string | null;
  state: PaymentState;
  confirmationUrl: string | null;
  reason: string | null;
  createdAt: Date;
  createRetryAllowed: boolean;
  placementId: string | null;
};
export type PaymentSettings = {
  shopId: string;
  mode: 'sandbox' | 'live';
  returnUrl: string;
  creatorShareBps: number;
};
export function bindingFailure(
  attempt: PaymentAttempt,
  seen: PaymentObservation,
): string | null {
  if (attempt.providerPaymentId && seen.id !== attempt.providerPaymentId)
    return 'PAYMENT_ID_MISMATCH';
  if (seen.orderId !== attempt.orderId) return 'ORDER_MISMATCH';
  if (seen.shopId !== attempt.shopId) return 'MERCHANT_MISMATCH';
  if (seen.test !== (attempt.mode === 'sandbox')) return 'MODE_MISMATCH';
  if (seen.amountMinor !== attempt.amountMinor) return 'AMOUNT_MISMATCH';
  if (seen.currency !== attempt.currency) return 'CURRENCY_MISMATCH';
  return null;
}
export interface PaymentRepository {
  create(
    userId: string,
    reservationId: string,
    autographId: string,
    settings: PaymentSettings,
    confirmation?: CheckoutConfirmation,
  ): Promise<PaymentAttempt>;
  checkout?(
    userId: string,
    reservationId: string,
    autographId: string,
  ): Promise<CheckoutSummary | { existingOrderId: string }>;
  findByReservation?(
    userId: string,
    reservationId: string,
  ): Promise<PaymentAttempt | null>;
  find(id: string): Promise<PaymentAttempt | null>;
  lease(id: string): Promise<string | null>;
  release(id: string, token: string): Promise<void>;
  observe(
    id: string,
    token: string,
    observation: PaymentObservation,
  ): Promise<void>;
  recordFailure(id: string, token: string, reason: string): Promise<void>;
  receipt(id: string, event: string): Promise<void>;
  completeReceipt(id: string, event: string, result: string): Promise<void>;
  due(limit: number): Promise<string[]>;
  anomalies(): Promise<Array<{ orderId: string; reason: string }>>;
}
export type PaymentSignal = (signal: {
  event: 'payment_attention';
  orderId: string;
  reason: string;
}) => void;
export class PaymentService {
  constructor(
    private readonly repository: PaymentRepository,
    private readonly provider: PaymentProvider,
    private readonly settings: PaymentSettings,
    private readonly signal: PaymentSignal = () => {},
  ) {}
  private present(p: PaymentAttempt) {
    return {
      id: p.orderId,
      reservationId: p.reservationId,
      amountMinor: p.amountMinor,
      currency: p.currency,
      status: p.state,
      confirmationUrl:
        p.state === 'provider_pending' ? p.confirmationUrl : null,
      placementId: p.placementId,
    };
  }
  async existing(userId: string, reservationId: string) {
    return this.repository.findByReservation?.(userId, reservationId) ?? null;
  }
  async checkout(userId: string, reservationId: string, autographId: string) {
    if (!this.repository.checkout)
      throw new PaymentError('PAYMENT_UNAVAILABLE');
    return this.repository.checkout(userId, reservationId, autographId);
  }
  async create(
    userId: string,
    reservationId: string,
    autographId: string,
    confirmation?: CheckoutConfirmation,
  ) {
    const attempt = await this.repository.create(
      userId,
      reservationId,
      autographId,
      this.settings,
      confirmation,
    );
    await this.progress(attempt.orderId);
    return this.status(userId, attempt.orderId);
  }
  async status(userId: string, id: string) {
    const attempt = await this.repository.find(id);
    if (!attempt || attempt.userId !== userId)
      throw new PaymentError('ORDER_NOT_FOUND');
    return this.present(attempt);
  }
  async refresh(userId: string, id: string) {
    await this.status(userId, id);
    await this.progress(id);
    return this.status(userId, id);
  }
  async progress(id: string): Promise<boolean> {
    const token = await this.repository.lease(id);
    if (!token) return false;
    try {
      const attempt = await this.repository.find(id);
      if (!attempt) throw new PaymentError('ORDER_NOT_FOUND');
      if (
        attempt.shopId !== this.settings.shopId ||
        attempt.mode !== this.settings.mode
      )
        throw new PaymentError('CONFIG_BINDING_MISMATCH');
      let providerId = attempt.providerPaymentId;
      if (!providerId) {
        if (
          attempt.state === 'canceled' ||
          attempt.reason === 'PROVIDER_REJECTED'
        )
          return true;
        // 23h safety margin to the documented 24h provider retention. Never a new key.
        if (!attempt.createRetryAllowed)
          throw new PaymentError('CREATE_UNKNOWN_REQUIRES_MANUAL_REVIEW');
        const created = await this.provider.createPayment(
          attempt,
          attempt.operationKey,
          attempt.requestFingerprint,
        );
        const failure = bindingFailure(attempt, created);
        if (failure) throw new PaymentError(failure);
        // Persist provider identity immediately. This response is authenticated too;
        // fulfillment still requires a fresh GET below.
        await this.repository.observe(id, token, {
          ...created,
          rawStatus: 'pending',
          paid: false,
        });
        providerId = created.id;
      }
      const seen = await this.provider.getPayment(providerId);
      await this.repository.observe(id, token, seen);
      const current = await this.repository.find(id);
      if (current?.reason)
        this.signal({
          event: 'payment_attention',
          orderId: id,
          reason: current.reason,
        });
      return true;
    } catch (error) {
      const reason =
        error instanceof PaymentError
          ? error.code
          : 'PAYMENT_RECONCILIATION_FAILED';
      await this.repository.recordFailure(id, token, reason);
      this.signal({ event: 'payment_attention', orderId: id, reason });
      return false;
    } finally {
      await this.repository.release(id, token);
    }
  }
  async webhook(providerId: string, event: string) {
    // Body is only a lookup hint. Never trust its metadata, amount, paid, or status.
    let seen: PaymentObservation;
    try {
      seen = await this.provider.getPayment(providerId);
    } catch {
      throw new PaymentError('PROVIDER_UNAVAILABLE');
    }
    const attempt = await this.repository.find(seen.orderId);
    if (!attempt) return;
    if (
      seen.id !== providerId ||
      attempt.shopId !== this.settings.shopId ||
      attempt.mode !== this.settings.mode
    )
      throw new PaymentError('UNVERIFIED_PAYMENT');
    await this.repository.receipt(providerId, event);
    const token = await this.repository.lease(attempt.orderId);
    if (!token) throw new PaymentError('PAYMENT_BUSY');
    try {
      // Fresh read under the per-payment I/O lease avoids stale concurrent responses.
      seen = await this.provider.getPayment(providerId);
      await this.repository.observe(attempt.orderId, token, seen);
      await this.repository.completeReceipt(providerId, event, 'observed');
    } catch (error) {
      const reason =
        error instanceof PaymentError
          ? error.code
          : 'PAYMENT_RECONCILIATION_FAILED';
      await this.repository.recordFailure(attempt.orderId, token, reason);
      await this.repository.completeReceipt(providerId, event, reason);
      this.signal({
        event: 'payment_attention',
        orderId: attempt.orderId,
        reason,
      });
      throw new PaymentError('UNVERIFIED_PAYMENT');
    } finally {
      await this.repository.release(attempt.orderId, token);
    }
  }
  async reconcile(limit = 50) {
    let processed = 0;
    for (const id of await this.repository.due(
      Math.min(100, Math.max(1, limit)),
    )) {
      if (await this.progress(id)) processed++;
    }
    const anomalies = await this.repository.anomalies();
    for (const item of anomalies)
      this.signal({ event: 'payment_attention', ...item });
    return { processed, attention: anomalies.length };
  }
}
