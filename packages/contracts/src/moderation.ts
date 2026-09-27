import { z } from 'zod';
import { moderationRejectionReasons } from '@digital-autograph/domain';
export { moderationRejectionReasons } from '@digital-autograph/domain';

export const moderationAutographParams = z.strictObject({ id: z.uuid() });
export const moderationQueueQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.uuid().optional(),
});
export const moderationDecisionBody = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('approved') }),
  z.strictObject({
    decision: z.literal('rejected'),
    reasonCode: z.enum(moderationRejectionReasons),
  }),
]);
