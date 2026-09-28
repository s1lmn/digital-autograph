import { describe, expect, it } from 'vitest';
import {
  PricingError,
  TakeoverQuoteService,
  type PricingRepository,
  type QuoteContext,
} from './pricing';

const now = new Date('2026-09-28T12:00:00.000Z');
const pricing = {
  id: 'config-a',
  algorithmVersion: 'takeover_ladder_v1' as const,
  currency: 'RUB' as const,
  baseAmountMinor: 50_000n,
  minimumAmountMinor: 10_000n,
  maximumAmountMinor: 100_000n,
  dynamicTakeoverLimit: 5,
  takeoverStepSize: 2,
  stepAmountMinor: 10_000n,
  decayIntervalSeconds: 60,
  decayAmountMinor: 5_000n,
  decayFloorAmountMinor: 20_000n,
  guaranteedVisibilitySeconds: 120,
};

const context: QuoteContext = {
  wall: { status: 'live', startAt: null, endAt: null },
  pricing,
  targetPlacement: {
    id: 'target',
    userId: 'seller',
    startedAt: new Date(now.getTime() - 120_000),
  },
  wallTakeoverCount: 0n,
  lastTakeoverAt: null,
  now,
};

function service(state: QuoteContext): TakeoverQuoteService {
  const repository: PricingRepository = {
    createConfig: async () => {
      throw new Error('unused');
    },
    assignWallConfig: async () => {
      throw new Error('unused');
    },
    async createQuote(input, ttlSeconds, calculate) {
      const result = calculate(state);
      if (!state.pricing || !state.targetPlacement)
        throw new Error('invalid test context');
      return {
        ...input,
        id: 'quote',
        targetPlacementId: state.targetPlacement.id,
        pricingConfigId: state.pricing.id,
        algorithmVersion: state.pricing.algorithmVersion,
        currency: state.pricing.currency,
        amountMinor: result.amountMinor,
        wallTakeoverCount: state.wallTakeoverCount,
        lastTakeoverAt: state.lastTakeoverAt,
        stepIndex: result.stepIndex,
        ladderAmountMinor: result.ladderAmountMinor,
        decayIntervalsApplied: result.decayIntervalsApplied,
        baseAmountMinor: state.pricing.baseAmountMinor,
        quotedAt: state.now,
        expiresAt: new Date(state.now.getTime() + ttlSeconds * 1000),
      };
    },
  };
  return new TakeoverQuoteService(repository);
}

const input = { userId: 'buyer', wallId: 'wall', slotId: 'slot' };

describe('Takeover Quote boundary rules', () => {
  it('includes exact startAt and exact cooldown end', async () => {
    const response = await service({
      ...context,
      wall: { status: 'live', startAt: now, endAt: null },
    }).createQuote(input);
    expect(response).toMatchObject({
      amountMinor: '50000',
      targetPlacementId: 'target',
      expiresAt: new Date(now.getTime() + 120_000),
    });
  });

  it('excludes exact endAt', async () => {
    await expect(
      service({
        ...context,
        wall: { status: 'live', startAt: null, endAt: now },
      }).createQuote(input),
    ).rejects.toMatchObject({ code: 'WALL_NOT_TAKEOVER_ELIGIBLE' });
  });

  it('rejects one millisecond before cooldown end with safe availableAt', async () => {
    const startedAt = new Date(now.getTime() - 119_999);
    await expect(
      service({
        ...context,
        targetPlacement: { id: 'target', userId: 'seller', startedAt },
      }).createQuote(input),
    ).rejects.toMatchObject({
      code: 'TAKEOVER_COOLDOWN_ACTIVE',
      availableAt: new Date(now.getTime() + 1),
    });
  });

  it('rejects own active Placement and a missing config', async () => {
    await expect(
      service({
        ...context,
        targetPlacement: {
          id: 'target',
          userId: 'buyer',
          startedAt: context.targetPlacement!.startedAt,
        },
      }).createQuote(input),
    ).rejects.toMatchObject({ code: 'OWN_PLACEMENT' });
    await expect(
      service({ ...context, pricing: null }).createQuote(input),
    ).rejects.toMatchObject({ code: 'PRICING_NOT_CONFIGURED' });
  });

  it('bounds Quote TTL independently of Reservation', () => {
    expect(
      () => new TakeoverQuoteService({} as PricingRepository, 29),
    ).toThrow();
    expect(
      () => new TakeoverQuoteService({} as PricingRepository, 301),
    ).toThrow();
    expect(new PricingError('SLOT_EMPTY').code).toBe('SLOT_EMPTY');
  });
});
