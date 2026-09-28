import {
  calculateTakeoverPrice,
  isWallFreeClaimEligible,
  PricingRuleError,
  validatePricingConfiguration,
  type PricingCalculation,
  type PricingConfiguration,
  type WallStatus,
} from '@digital-autograph/domain';

export type PricingVersion = PricingConfiguration & { id: string };

export type QuoteContext = {
  wall: { status: WallStatus; startAt: Date | null; endAt: Date | null };
  pricing: PricingVersion | null;
  targetPlacement: { id: string; userId: string; startedAt: Date } | null;
  wallTakeoverCount: bigint;
  lastTakeoverAt: Date | null;
  now: Date;
};

export type QuoteInput = { userId: string; wallId: string; slotId: string };

export type PersistedQuote = QuoteInput & {
  id: string;
  targetPlacementId: string;
  pricingConfigId: string;
  algorithmVersion: 'takeover_ladder_v1';
  currency: 'RUB';
  amountMinor: bigint;
  wallTakeoverCount: bigint;
  lastTakeoverAt: Date | null;
  stepIndex: bigint;
  ladderAmountMinor: bigint;
  decayIntervalsApplied: bigint;
  baseAmountMinor: bigint;
  quotedAt: Date;
  expiresAt: Date;
};

export type QuoteResponse = {
  id: string;
  wallId: string;
  slotId: string;
  targetPlacementId: string;
  amountMinor: string;
  currency: 'RUB';
  expiresAt: Date;
  pricingVersion: string;
  algorithmVersion: 'takeover_ladder_v1';
  explanation: {
    wallTakeoverCount: string;
    baseAmountMinor: string;
    ladderAmountMinor: string;
    stepIndex: string;
    decayIntervalsApplied: string;
    finalAmountMinor: string;
    lastTakeoverAt: Date | null;
  };
};

export type PricingErrorCode =
  | 'FORBIDDEN'
  | 'WALL_NOT_FOUND'
  | 'SLOT_NOT_FOUND'
  | 'SLOT_NOT_IN_WALL'
  | 'PRICING_CONFIG_NOT_FOUND'
  | 'WALL_PRICING_ALREADY_SET'
  | 'INVALID_PRICING_CONFIG'
  | 'PRICING_NOT_CONFIGURED'
  | 'WALL_NOT_TAKEOVER_ELIGIBLE'
  | 'SLOT_EMPTY'
  | 'OWN_PLACEMENT'
  | 'TAKEOVER_COOLDOWN_ACTIVE'
  | 'INVALID_PRICING_STATE';

export class PricingError extends Error {
  constructor(
    readonly code: PricingErrorCode,
    readonly availableAt?: Date,
  ) {
    super(code);
  }
}

export interface PricingRepository {
  createConfig(
    actorUserId: string,
    config: PricingConfiguration,
    activateForNewWalls: boolean,
  ): Promise<{ id: string; createdAt: Date; activeForNewWalls: boolean }>;
  assignWallConfig(
    actorUserId: string,
    wallId: string,
    pricingConfigId: string,
  ): Promise<{ wallId: string; pricingConfigId: string }>;
  createQuote(
    input: QuoteInput,
    ttlSeconds: number,
    calculate: (context: QuoteContext) => PricingCalculation,
  ): Promise<PersistedQuote>;
}

function calculateEligibleQuote(
  userId: string,
  context: QuoteContext,
): PricingCalculation {
  if (!context.pricing) throw new PricingError('PRICING_NOT_CONFIGURED');
  if (!isWallFreeClaimEligible(context.wall, context.now)) {
    throw new PricingError('WALL_NOT_TAKEOVER_ELIGIBLE');
  }
  const placement = context.targetPlacement;
  if (!placement) throw new PricingError('SLOT_EMPTY');
  if (placement.userId === userId) throw new PricingError('OWN_PLACEMENT');
  const availableAt = new Date(
    placement.startedAt.getTime() +
      context.pricing.guaranteedVisibilitySeconds * 1000,
  );
  if (context.now < availableAt) {
    throw new PricingError('TAKEOVER_COOLDOWN_ACTIVE', availableAt);
  }
  try {
    return calculateTakeoverPrice(
      {
        wallTakeoverCount: context.wallTakeoverCount,
        lastTakeoverAt: context.lastTakeoverAt,
        now: context.now,
      },
      context.pricing,
    );
  } catch (error) {
    if (error instanceof PricingRuleError) {
      throw new PricingError('INVALID_PRICING_STATE');
    }
    throw error;
  }
}

export class TakeoverQuoteService {
  constructor(
    private readonly repository: PricingRepository,
    private readonly quoteTtlSeconds = 120,
  ) {
    if (
      !Number.isInteger(quoteTtlSeconds) ||
      quoteTtlSeconds < 30 ||
      quoteTtlSeconds > 300
    ) {
      throw new Error('Quote TTL must be 30–300 seconds');
    }
  }

  async createConfig(
    actorUserId: string,
    config: PricingConfiguration,
    activateForNewWalls: boolean,
  ) {
    try {
      validatePricingConfiguration(config);
    } catch (error) {
      if (error instanceof PricingRuleError) {
        throw new PricingError('INVALID_PRICING_CONFIG');
      }
      throw error;
    }
    return this.repository.createConfig(
      actorUserId,
      config,
      activateForNewWalls,
    );
  }

  assignWallConfig(
    actorUserId: string,
    wallId: string,
    pricingConfigId: string,
  ) {
    return this.repository.assignWallConfig(
      actorUserId,
      wallId,
      pricingConfigId,
    );
  }

  async createQuote(input: QuoteInput): Promise<QuoteResponse> {
    const quote = await this.repository.createQuote(
      input,
      this.quoteTtlSeconds,
      (context) => calculateEligibleQuote(input.userId, context),
    );
    return {
      id: quote.id,
      wallId: quote.wallId,
      slotId: quote.slotId,
      targetPlacementId: quote.targetPlacementId,
      amountMinor: quote.amountMinor.toString(),
      currency: quote.currency,
      expiresAt: quote.expiresAt,
      pricingVersion: quote.pricingConfigId,
      algorithmVersion: quote.algorithmVersion,
      explanation: {
        wallTakeoverCount: quote.wallTakeoverCount.toString(),
        baseAmountMinor: quote.baseAmountMinor.toString(),
        ladderAmountMinor: quote.ladderAmountMinor.toString(),
        stepIndex: quote.stepIndex.toString(),
        decayIntervalsApplied: quote.decayIntervalsApplied.toString(),
        finalAmountMinor: quote.amountMinor.toString(),
        lastTakeoverAt: quote.lastTakeoverAt,
      },
    };
  }
}
