import { z } from 'zod';
export const checkoutTermsSchema = z.strictObject({
  amountMinor: z.string().regex(/^[1-9][0-9]{0,11}$/),
  currency: z.literal('RUB'),
  guaranteedVisibilitySeconds: z.number().int().nonnegative(),
  reservationExpiresAt: z.iso.datetime(),
  targetPlacementId: z.uuid(),
  pricingConfigId: z.uuid(),
});
export const checkoutDocumentsSchema = z
  .array(
    z.strictObject({
      type: z.enum(['public_offer', 'community_guidelines', 'refund_policy']),
      version: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/),
      hash: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  )
  .length(3)
  .refine((ds) => new Set(ds.map((d) => d.type)).size === 3);
export const checkoutConfirmationSchema = z.strictObject({
  confirmed: z.literal(true),
  documents: checkoutDocumentsSchema,
  terms: checkoutTermsSchema,
});
export const createPaymentOrderBody = z.strictObject({
  reservationId: z.uuid(),
  autographId: z.uuid(),
  confirmation: checkoutConfirmationSchema.optional(),
});
export const checkoutQuerySchema = z.strictObject({
  reservationId: z.uuid(),
  autographId: z.uuid(),
});
export const checkoutSummarySchema = checkoutTermsSchema.extend({
  reservationId: z.uuid(),
  autographId: z.uuid(),
  wallId: z.uuid(),
  wallTitle: z.string().min(1).max(200),
  creatorName: z.string().min(1).max(200),
  slotId: z.uuid(),
  slotNumber: z.number().int().positive(),
  documents: checkoutDocumentsSchema,
});
