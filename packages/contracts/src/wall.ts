import { z } from 'zod';

export const wallIdParams = z.strictObject({ id: z.uuid() });
export const creatorIdParams = z.strictObject({ creatorId: z.uuid() });
export const creatorSlugParams = z.strictObject({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(128),
});

const dateTime = z.iso.datetime({ offset: true });

export const createWallBody = z.strictObject({
  slotCount: z.number().int().min(1).max(1000),
  startAt: dateTime.nullable().optional(),
  endAt: dateTime.nullable().optional(),
});

export const updateWallBody = createWallBody
  .partial()
  .refine((value) => Object.keys(value).length > 0);

export const wallTransitionBody = z.strictObject({
  action: z.enum([
    'schedule',
    'unschedule',
    'publish',
    'pause',
    'resume',
    'end',
    'archive',
  ]),
});

export const freeClaimParams = z.strictObject({
  wallId: z.uuid(),
  slotId: z.uuid(),
});

export const freeClaimBody = z.strictObject({ autographId: z.uuid() });

export const publicPlacementMediaParams = z.strictObject({
  placementId: z.uuid(),
});
