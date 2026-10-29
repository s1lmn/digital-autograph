import { describe, expect, it } from 'vitest';
import { createPricingConfigBody } from '../../../packages/contracts/src/pricing';
import { calculateTakeoverPrice } from '../../../packages/domain/src/pricing';
import {
  approvedDestkaPolicy,
  buildDestkaPricingPlan,
  noDecayDropScenario,
  noDecaySimulationConfig,
} from './destka-pricing-plan';

describe('owner-approved Destka pricing preparation', () => {
  it('pins the exact owner decision but leaves unapproved and runtime fields absent', () => {
    expect(approvedDestkaPolicy.pricing).toEqual({
      algorithmVersion: 'takeover_ladder_v1',
      currency: 'RUB',
      baseAmountMinor: '8900',
      minimumAmountMinor: '8900',
      maximumAmountMinor: '498900',
      stepAmountMinor: '10000',
      takeoverStepSize: 1,
      dynamicTakeoverLimit: 49,
      guaranteedVisibilitySeconds: 900,
    });
    expect(approvedDestkaPolicy.creatorShareBps).toBe(5000);
    expect(
      Object.values(approvedDestkaPolicy.pendingDecisions).every(
        (x) => x === null,
      ),
    ).toBe(true);
    expect(approvedDestkaPolicy.productionApplication).toBe('not-authorized');
    expect(buildDestkaPricingPlan().runtimePricingConfig).toBeNull();
    expect(
      createPricingConfigBody.safeParse({
        ...approvedDestkaPolicy.pricing,
        activateForNewWalls: false,
      }).success,
    ).toBe(false);
  });
  it.each([
    [0, 8900n],
    [1, 18900n],
    [2, 28900n],
    [3, 38900n],
    [4, 48900n],
    [48, 488900n],
    [49, 498900n],
    [50, 498900n],
    [10000, 498900n],
  ])(
    'quotes after %i successful Wall takeovers at %s kopecks without decay',
    (count, expected) => {
      const now = new Date('2026-10-27T00:00:00Z');
      const actual = calculateTakeoverPrice(
        {
          now,
          wallTakeoverCount: BigInt(count),
          lastTakeoverAt: count ? now : null,
        },
        noDecaySimulationConfig(),
      );
      expect(actual.amountMinor).toBe(expected);
    },
  );
  it.each([
    [10, '539000'],
    [30, '4617000'],
    [100, '37640000'],
  ])(
    'calculates %i captures using the ladder, not the final price or slot multiplier',
    (n, expected) => {
      for (const slots of [5, 10, 20]) {
        const scenario = noDecayDropScenario(slots, n);
        expect(scenario.grossCapturedMinor).toBe(expected);
        expect(scenario.creatorRemunerationMinor).toBeNull();
        expect(scenario.contributionMarginMinor).toBeNull();
        expect(scenario.refundSensitivities.map((x) => x.rateBps)).toEqual([
          100, 300, 500,
        ]);
        expect(scenario.refundSensitivities[0]!.expectedPrincipalMinor).toEqual(
          {
            numerator: (BigInt(expected) * 100n).toString(),
            denominator: 10000,
          },
        );
      }
    },
  );
  it.each([0, -1, 1.5, 10001, NaN, Infinity])(
    'rejects unbounded/noninteger scenario count %s',
    (n) => {
      expect(() => noDecayDropScenario(5, n)).toThrow();
    },
  );
  it('produces nine explicitly hypothetical scenarios without assuming a payout base or zero fees', () => {
    const report = buildDestkaPricingPlan();
    expect(report.scenarios).toHaveLength(9);
    expect(
      report.scenarios.every(
        (x) => x.pendingCosts.length > 0 && x.creatorRemunerationMinor === null,
      ),
    ).toBe(true);
  });
});
