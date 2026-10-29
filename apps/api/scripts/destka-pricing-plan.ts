// Offline planning/tests only. No runtime imports, DB writes, env or provider calls.
import process from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import policy from '../../../docs/product/destka-pricing-2026-10-27-v1.json';
import {
  calculateTakeoverPrice,
  type PricingConfiguration,
} from '../../../packages/domain/src/pricing';

export { policy as approvedDestkaPolicy };

// An explicit NO-DECAY experiment, NOT an approved admin payload or default.
// Real config creation remains blocked on the owner's separate decay decision.
export function noDecaySimulationConfig(): PricingConfiguration {
  return {
    ...policy.pricing,
    algorithmVersion: 'takeover_ladder_v1',
    currency: 'RUB',
    baseAmountMinor: BigInt(policy.pricing.baseAmountMinor),
    minimumAmountMinor: BigInt(policy.pricing.minimumAmountMinor),
    maximumAmountMinor: BigInt(policy.pricing.maximumAmountMinor),
    stepAmountMinor: BigInt(policy.pricing.stepAmountMinor),
    decayAmountMinor: 0n,
    decayIntervalSeconds: 1,
    decayFloorAmountMinor: BigInt(policy.pricing.minimumAmountMinor),
  };
}

export function noDecayDropScenario(slotCount: number, takeoverCount: number) {
  if (
    ![5, 10, 20].includes(slotCount) ||
    !Number.isSafeInteger(takeoverCount) ||
    takeoverCount < 1 ||
    takeoverCount > 10000
  )
    throw new Error('Invalid bounded offline scenario');
  const config = noDecaySimulationConfig();
  const now = new Date('2026-10-27T00:00:00.000Z');
  const price = (count: number) =>
    calculateTakeoverPrice(
      {
        wallTakeoverCount: BigInt(count),
        lastTakeoverAt: count ? now : null,
        now,
      },
      config,
    ).amountMinor;
  let gross = 0n;
  for (let completed = 0; completed < takeoverCount; completed++)
    gross += price(completed);
  return {
    slotCount,
    takeoverCount,
    assumption:
      'no-decay; activity is a hypothesis, not a forecast or deployment config',
    grossCapturedMinor: gross.toString(),
    averagePaymentMinor: {
      numerator: gross.toString(),
      denominator: takeoverCount,
    },
    nextTakeoverPriceMinor: price(takeoverCount).toString(),
    creatorShareBps: policy.creatorShareBps,
    creatorRemunerationMinor: null,
    contributionMarginMinor: null,
    pendingCosts: [
      'merchant fees',
      'receipts',
      'tax sign-off',
      'creator basis/adjustments',
      'infra/moderation',
      'chargebacks',
    ],
    // Full-principal refund sensitivity only, NOT accepted consumer refund rules.
    refundSensitivities: [100, 300, 500].map((rateBps) => ({
      rateBps,
      expectedPrincipalMinor: {
        numerator: (gross * BigInt(rateBps)).toString(),
        denominator: 10000,
      },
      creatorAdjustmentMinor: null,
      marginMinor: null,
    })),
  };
}

export function buildDestkaPricingPlan() {
  return {
    kind: 'offline-product-pricing-plan-not-runtime-config',
    policy,
    runtimePricingConfig: null,
    activationBlockers: [
      'owner-approved decay',
      'creator revenue basis/refund/chargeback policy',
      'merchant/fiscal/tax acceptance',
      'separate production authorization',
    ],
    scenarios: [
      { name: 'conservative', takeoverCount: 10 },
      { name: 'base', takeoverCount: 30 },
      { name: 'aggressive', takeoverCount: 100 },
    ].flatMap(({ name, takeoverCount }) =>
      [5, 10, 20].map((slots) => ({
        name,
        ...noDecayDropScenario(slots, takeoverCount),
      })),
    ),
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.stdout.write(
    JSON.stringify(buildDestkaPricingPlan(), null, 2) + '\n',
  );
}
