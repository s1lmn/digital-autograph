import { z } from 'zod';

export const autographIdParams = z.strictObject({ id: z.uuid() });
export const createAutographBody = z.strictObject({
  source: z.enum(['photo', 'canvas']),
});
export const initiateOriginalUploadBody = z.strictObject({
  contentType: z.enum(['image/png', 'image/jpeg']),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024),
});
export const completeOriginalUploadBody = z.strictObject({});
