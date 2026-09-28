import { describe, expect, it } from 'vitest';
import {
  calculateTakeoverPrice,
  maximumPricingAmountMinor,
  PricingRuleError,
  validatePricingConfiguration,
  type PricingConfiguration,
} from './pricing';

const config: PricingConfiguration = {
  algorithmVersion: 'takeover_ladder_v1',
  currency: 'RUB',
  baseAmountMinor: 50_001n,
  minimumAmountMinor: 10_001n,
  maximumAmountMinor: 100_001n,
  dynamicTakeoverLimit: 3,
  takeoverStepSize: 2,
  stepAmountMinor: 10_001n,
  decayIntervalSeconds: 60,
  decayAmountMinor: 5_001n,
  decayFloorAmountMinor: 20_001n,
  guaranteedVisibilitySeconds: 120,
};
const now = new Date('2026-09-28T12:00:00.000Z');

describe('takeover_ladder_v1', () => {
  it.each([
    {
      name: 'first takeover',
      count: 0n,
      seconds: null,
      amount: 50_001n,
      step: 0n,
      intervals: 0n,
    },
    {
      name: 'step boundary minus one',
      count: 1n,
      seconds: 0,
      amount: 50_001n,
      step: 0n,
      intervals: 0n,
    },
    {
      name: 'exact step boundary',
      count: 2n,
      seconds: 0,
      amount: 60_002n,
      step: 1n,
      intervals: 0n,
    },
    {
      name: 'dynamic limit',
      count: 100n,
      seconds: 0,
      amount: 80_004n,
      step: 3n,
      intervals: 0n,
    },
    {
      name: 'before first decay',
      count: 2n,
      seconds: 59,
      amount: 60_002n,
      step: 1n,
      intervals: 0n,
    },
    {
      name: 'exact first decay',
      count: 2n,
      seconds: 60,
      amount: 55_001n,
      step: 1n,
      intervals: 1n,
    },
    {
      name: 'multiple decay intervals',
      count: 2n,
      seconds: 180,
      amount: 44_999n,
      step: 1n,
      intervals: 3n,
    },
    {
      name: 'decay floor',
      count: 2n,
      seconds: 3600,
      amount: 20_001n,
      step: 1n,
      intervals: 60n,
    },
  ])(
    '$name uses exact kopecks',
    ({ count, seconds, amount, step, intervals }) => {
      const result = calculateTakeoverPrice(
        {
          wallTakeoverCount: count,
          lastTakeoverAt:
            seconds === null ? null : new Date(now.getTime() - seconds * 1000),
          now,
        },
        config,
      );
      expect(result.amountMinor).toBe(amount);
      expect(result.stepIndex).toBe(step);
      expect(result.decayIntervalsApplied).toBe(intervals);
    },
  );

  it('caps the ladder and does not let a high decay floor raise a lower ladder', () => {
    const capped = { ...config, maximumAmountMinor: 65_001n };
    expect(
      calculateTakeoverPrice(
        { wallTakeoverCount: 100n, lastTakeoverAt: now, now },
        capped,
      ).amountMinor,
    ).toBe(65_001n);
    const highFloor = { ...config, decayFloorAmountMinor: 80_000n };
    expect(
      calculateTakeoverPrice(
        {
          wallTakeoverCount: 2n,
          lastTakeoverAt: new Date(now.getTime() - 60_000),
          now,
        },
        highFloor,
      ).amountMinor,
    ).toBe(60_002n);
  });

  it('uses the minimum when the configured floor equals it', () => {
    const minimum = {
      ...config,
      decayFloorAmountMinor: config.minimumAmountMinor,
    };
    expect(
      calculateTakeoverPrice(
        {
          wallTakeoverCount: 2n,
          lastTakeoverAt: new Date(now.getTime() - 3_600_000),
          now,
        },
        minimum,
      ).amountMinor,
    ).toBe(10_001n);
  });

  it('handles large but bounded values without number conversion', () => {
    const large = {
      ...config,
      baseAmountMinor: maximumPricingAmountMinor - 1n,
      maximumAmountMinor: maximumPricingAmountMinor,
      stepAmountMinor: 1n,
    };
    const result = calculateTakeoverPrice(
      { wallTakeoverCount: 2n, lastTakeoverAt: now, now },
      large,
    );
    expect(result.amountMinor).toBe(maximumPricingAmountMinor);
    expect(typeof result.amountMinor).toBe('bigint');
  });

  it.each([
    { minimumAmountMinor: 100_002n },
    { baseAmountMinor: 0n },
    { baseAmountMinor: 100_002n },
    { takeoverStepSize: 0 },
    { takeoverStepSize: -1 },
    { decayIntervalSeconds: 0 },
    { decayAmountMinor: -1n },
    { decayFloorAmountMinor: 9_999n },
    { maximumAmountMinor: maximumPricingAmountMinor + 1n },
  ])('rejects invalid config %#', (patch) => {
    expect(() =>
      validatePricingConfiguration({ ...config, ...patch }),
    ).toThrowError(PricingRuleError);
  });

  it('rejects an inconsistent or future activity snapshot', () => {
    expect(() =>
      calculateTakeoverPrice(
        { wallTakeoverCount: 1n, lastTakeoverAt: null, now },
        config,
      ),
    ).toThrowError(PricingRuleError);
    expect(() =>
      calculateTakeoverPrice(
        {
          wallTakeoverCount: 1n,
          lastTakeoverAt: new Date(now.getTime() + 1),
          now,
        },
        config,
      ),
    ).toThrowError(PricingRuleError);
  });
});
