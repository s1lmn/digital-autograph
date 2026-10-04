import { z } from 'zod';
import { notificationKinds } from '@digital-autograph/domain';
export const notificationPreferencesBody = z
  .object({
    web: z.boolean(),
    telegram: z.boolean(),
    mutedKinds: z.array(z.enum(notificationKinds)).max(7),
  })
  .strict();
export const notificationIdParams = z.object({ id: z.uuid() }).strict();
export const notificationFollowBody = z
  .object({ enabled: z.boolean() })
  .strict();
export const shareCreateBody = z
  .object({
    wallId: z.uuid(),
    slotId: z.uuid().optional(),
    publicAlias: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[\p{L}\p{N}_ .-]+$/u)
      .optional(),
    publishAlias: z.boolean().optional(),
  })
  .strict()
  .refine((v) => !v.publicAlias || v.publishAlias === true);
export const shareInteractionBody = z
  .object({
    kind: z.enum(['share_clicked', 'referral_arrived']),
    dedupeKey: z.uuid(),
  })
  .strict();
