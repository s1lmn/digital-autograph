import { z } from 'zod';

export const autographIdParams = z.strictObject({ id: z.uuid() });
export const readyAutographListQuery = z.strictObject({
  status: z.literal('ready'),
});
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
// A precondition from the owner-only preview, never authority to choose an asset.
export const approveAutographBody = z.strictObject({
  reviewedAssetId: z.uuid(),
});
