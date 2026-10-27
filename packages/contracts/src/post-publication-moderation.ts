import { z } from 'zod';
import { moderationRejectionReasons } from '@digital-autograph/domain';

// Proposed transport limits, not an approved safety/retention/SLA policy.
function privateStatement(maxCodeUnits: number, maxUtf8Bytes: number) {
  return z
    .string()
    .max(maxCodeUnits)
    .refine((value) => {
      if (value.length > maxCodeUnits) return false;
      for (const character of value) {
        const point = character.codePointAt(0) ?? 0;
        const supported =
          point === 9 ||
          point === 10 ||
          point === 13 ||
          (point >= 32 &&
            !(point >= 127 && point <= 159) &&
            !(point >= 0x202a && point <= 0x202e) &&
            !(point >= 0x2066 && point <= 0x2069));
        if (!supported) return false;
      }
      return true;
    }, 'Unsupported control character')
    .refine(
      (value) =>
        value.length <= maxCodeUnits && !/[\ud800-\udfff]/u.test(value),
      'Invalid Unicode',
    )
    .refine(
      (value) =>
        value.length <= maxCodeUnits &&
        new TextEncoder().encode(value).length <= maxUtf8Bytes,
      'Text exceeds UTF-8 byte limit',
    )
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, 'Text must not be blank');
}

// No handler uses these contracts yet. The server must resolve this public
// Placement to current visibility and immutable approved derivative evidence.
export const publicPlacementReportParams = z.strictObject({
  placementId: z.uuid(),
});
export const publicPlacementReportBody = z.strictObject({
  operationKey: z.uuid(),
  reasonCode: z.enum(moderationRejectionReasons),
  comment: privateStatement(1000, 2000).optional(),
});

// Case/decision IDs are references, never proof of ownership or permission.
export const moderationCaseAppealParams = z.strictObject({ caseId: z.uuid() });
export const moderationCaseAppealBody = z.strictObject({
  operationKey: z.uuid(),
  decisionId: z.uuid(),
  statement: privateStatement(2000, 4000),
});
