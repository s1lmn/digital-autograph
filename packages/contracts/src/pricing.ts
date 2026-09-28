import { z } from 'zod';

const amountMinor = z.string().regex(/^(0|[1-9][0-9]{0,11})$/);

export const createPricingConfigBody = z.strictObject({
  algorithmVersion: z.literal('takeover_ladder_v1'),
  currency: z.literal('RUB'),
  baseAmountMinor: amountMinor,
  minimumAmountMinor: amountMinor,
  maximumAmountMinor: amountMinor,
  dynamicTakeoverLimit: z.number().int(),
  takeoverStepSize: z.number().int(),
  stepAmountMinor: amountMinor,
  decayIntervalSeconds: z.number().int(),
  decayAmountMinor: amountMinor,
  decayFloorAmountMinor: amountMinor,
  guaranteedVisibilitySeconds: z.number().int(),
  activateForNewWalls: z.boolean().default(false),
});

export const assignWallPricingParams = z.strictObject({ wallId: z.uuid() });
export const assignWallPricingBody = z.strictObject({
  pricingConfigId: z.uuid(),
});
export const takeoverQuoteParams = z.strictObject({
  wallId: z.uuid(),
  slotId: z.uuid(),
});
export const takeoverQuoteBody = z.strictObject({});
