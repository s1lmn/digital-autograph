import { createHash } from 'node:crypto';

export type ReservationStatus = 'active' | 'expired' | 'cancelled' | 'consumed';

export type TakeoverReservation = {
  id: string;
  quoteId: string;
  wallId: string;
  slotId: string;
  targetPlacementId: string;
  pricingConfigId: string;
  amountMinor: string;
  currency: 'RUB';
  status: ReservationStatus;
  createdAt: Date;
  expiresAt: Date;
};

export type ReservationCreation = {
  reservation: TakeoverReservation;
  created: boolean;
};

export type ReservationErrorCode =
  | 'QUOTE_NOT_FOUND'
  | 'QUOTE_EXPIRED'
  | 'QUOTE_ALREADY_RESERVED'
  | 'QUOTE_TARGET_STALE'
  | 'INVALID_QUOTE_STATE'
  | 'WALL_NOT_TAKEOVER_ELIGIBLE'
  | 'TAKEOVER_COOLDOWN_ACTIVE'
  | 'SLOT_RESERVED'
  | 'USER_RESERVATION_ACTIVE'
  | 'RESERVATION_RATE_LIMITED'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'INVALID_IDEMPOTENCY_KEY'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'RESERVATION_NOT_FOUND';

export class ReservationError extends Error {
  constructor(
    readonly code: ReservationErrorCode,
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
  }
}

export interface TakeoverReservationRepository {
  create(input: {
    userId: string;
    quoteId: string;
    idempotencyKeyHash: string;
    ttlSeconds: number;
  }): Promise<ReservationCreation>;
  findOwned(
    userId: string,
    reservationId: string,
  ): Promise<TakeoverReservation>;
  cancelOwned(
    userId: string,
    reservationId: string,
  ): Promise<TakeoverReservation>;
}

export class TakeoverReservationService {
  constructor(
    private readonly repository: TakeoverReservationRepository,
    private readonly ttlSeconds = 240,
  ) {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 180 || ttlSeconds > 300) {
      throw new Error('Reservation TTL must be 180–300 seconds');
    }
  }

  create(userId: string, quoteId: string, rawKey: unknown) {
    if (rawKey === undefined) {
      throw new ReservationError('IDEMPOTENCY_KEY_REQUIRED');
    }
    if (typeof rawKey !== 'string') {
      throw new ReservationError('INVALID_IDEMPOTENCY_KEY');
    }
    const key = rawKey.trim();
    if (!/^[A-Za-z0-9._~-]{16,128}$/.test(key)) {
      throw new ReservationError('INVALID_IDEMPOTENCY_KEY');
    }
    return this.repository.create({
      userId,
      quoteId,
      idempotencyKeyHash: createHash('sha256').update(key).digest('hex'),
      ttlSeconds: this.ttlSeconds,
    });
  }

  findOwned(userId: string, reservationId: string) {
    return this.repository.findOwned(userId, reservationId);
  }

  cancelOwned(userId: string, reservationId: string) {
    return this.repository.cancelOwned(userId, reservationId);
  }
}
