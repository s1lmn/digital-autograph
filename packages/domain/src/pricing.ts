export const takeoverAlgorithmVersion = 'takeover_ladder_v1' as const;
export const pricingCurrency = 'RUB' as const;
export const maximumPricingAmountMinor = 100_000_000_000n;

export type PricingConfiguration = {
  algorithmVersion: typeof takeoverAlgorithmVersion;
  currency: typeof pricingCurrency;
  baseAmountMinor: bigint;
  minimumAmountMinor: bigint;
  maximumAmountMinor: bigint;
  dynamicTakeoverLimit: number;
  takeoverStepSize: number;
  stepAmountMinor: bigint;
  decayIntervalSeconds: number;
  decayAmountMinor: bigint;
  decayFloorAmountMinor: bigint;
  guaranteedVisibilitySeconds: number;
};

export type PricingSnapshot = {
  wallTakeoverCount: bigint;
  lastTakeoverAt: Date | null;
  now: Date;
};

export type PricingCalculation = {
  amountMinor: bigint;
  ladderAmountMinor: bigint;
  stepIndex: bigint;
  decayIntervalsApplied: bigint;
};

export class PricingRuleError extends Error {
  constructor(
    readonly code: 'INVALID_PRICING_CONFIG' | 'INVALID_PRICING_STATE',
  ) {
    super(code);
  }
}

function whole(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

export function validatePricingConfiguration(
  config: PricingConfiguration,
): void {
  const validAmount = (value: bigint, allowZero = false) =>
    typeof value === 'bigint' &&
    value >= (allowZero ? 0n : 1n) &&
    value <= maximumPricingAmountMinor;
  if (
    config.algorithmVersion !== takeoverAlgorithmVersion ||
    config.currency !== pricingCurrency ||
    !validAmount(config.baseAmountMinor) ||
    !validAmount(config.minimumAmountMinor) ||
    !validAmount(config.maximumAmountMinor) ||
    !validAmount(config.stepAmountMinor, true) ||
    !validAmount(config.decayAmountMinor, true) ||
    !validAmount(config.decayFloorAmountMinor) ||
    config.minimumAmountMinor > config.baseAmountMinor ||
    config.baseAmountMinor > config.maximumAmountMinor ||
    config.decayFloorAmountMinor < config.minimumAmountMinor ||
    config.decayFloorAmountMinor > config.maximumAmountMinor ||
    !whole(config.dynamicTakeoverLimit, 0, 1_000_000) ||
    !whole(config.takeoverStepSize, 1, 1_000_000) ||
    !whole(config.decayIntervalSeconds, 1, 2_592_000) ||
    !whole(config.guaranteedVisibilitySeconds, 0, 2_592_000)
  ) {
    throw new PricingRuleError('INVALID_PRICING_CONFIG');
  }
}

export function calculateTakeoverPrice(
  snapshot: PricingSnapshot,
  config: PricingConfiguration,
): PricingCalculation {
  validatePricingConfiguration(config);
  const { wallTakeoverCount, lastTakeoverAt, now } = snapshot;
  if (
    wallTakeoverCount < 0n ||
    (wallTakeoverCount === 0n) !== (lastTakeoverAt === null) ||
    !Number.isFinite(now.getTime()) ||
    (lastTakeoverAt !== null &&
      (!Number.isFinite(lastTakeoverAt.getTime()) || lastTakeoverAt > now))
  ) {
    throw new PricingRuleError('INVALID_PRICING_STATE');
  }

  const stepIndex =
    wallTakeoverCount / BigInt(config.takeoverStepSize) <
    BigInt(config.dynamicTakeoverLimit)
      ? wallTakeoverCount / BigInt(config.takeoverStepSize)
      : BigInt(config.dynamicTakeoverLimit);
  const rawLadder = config.baseAmountMinor + stepIndex * config.stepAmountMinor;
  const ladderAmountMinor =
    rawLadder > config.maximumAmountMinor
      ? config.maximumAmountMinor
      : rawLadder < config.minimumAmountMinor
        ? config.minimumAmountMinor
        : rawLadder;
  const decayIntervalsApplied =
    lastTakeoverAt === null
      ? 0n
      : BigInt(now.getTime() - lastTakeoverAt.getTime()) /
        (BigInt(config.decayIntervalSeconds) * 1000n);
  const decayed =
    ladderAmountMinor - decayIntervalsApplied * config.decayAmountMinor;
  const effectiveFloor =
    config.decayFloorAmountMinor < ladderAmountMinor
      ? config.decayFloorAmountMinor
      : ladderAmountMinor;
  const amountMinor = decayed > effectiveFloor ? decayed : effectiveFloor;
  return { amountMinor, ladderAmountMinor, stepIndex, decayIntervalsApplied };
}
