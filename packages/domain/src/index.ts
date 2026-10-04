export const userStatuses = ['active', 'disabled', 'anonymized'] as const;
export const wallStatuses = [
  'draft',
  'scheduled',
  'live',
  'paused',
  'ended',
  'archived',
] as const;
export const placementSources = ['free_claim', 'takeover', 'admin'] as const;
export const administrativeRoles = ['moderator', 'finance', 'admin'] as const;
export const autographSources = ['photo', 'canvas'] as const;
export const autographStatuses = [
  'draft',
  'upload_pending',
  'uploaded_unverified',
  'processing',
  'awaiting_approval',
  'awaiting_moderation',
  'ready',
  'moderation_rejected',
  'processing_failed',
] as const;
export const moderationDecisions = ['approved', 'rejected'] as const;
export const moderationRejectionReasons = [
  'SEXUAL_CONTENT',
  'HATE_OR_EXTREMISM',
  'THREATS_OR_VIOLENCE',
  'PERSONAL_DATA',
  'IMPERSONATION_OR_DECEPTIVE',
  'ILLEGAL_OR_PROHIBITED',
  'NOT_AN_AUTOGRAPH',
  'OTHER_POLICY_VIOLATION',
] as const;
export const autographAssetRoles = ['original', 'cleaned'] as const;
export const autographAssetStatuses = ['reserved', 'uploaded'] as const;

export type UserStatus = (typeof userStatuses)[number];
export type WallStatus = (typeof wallStatuses)[number];
export type PlacementSource = (typeof placementSources)[number];
export type AdministrativeRole = (typeof administrativeRoles)[number];
export type AutographSource = (typeof autographSources)[number];
export type AutographStatus = (typeof autographStatuses)[number];
export type ModerationDecision = (typeof moderationDecisions)[number];
export type ModerationRejectionReason =
  (typeof moderationRejectionReasons)[number];
export const isAutographPlacementEligible = (status: AutographStatus) =>
  status === 'ready';

export function isWallFreeClaimEligible(
  wall: { status: WallStatus; startAt: Date | null; endAt: Date | null },
  now: Date,
): boolean {
  return (
    wall.status === 'live' &&
    (wall.startAt === null || wall.startAt <= now) &&
    (wall.endAt === null || wall.endAt > now)
  );
}

export function isWallTakeoverEligible(
  wall: { status: WallStatus; startAt: Date | null; endAt: Date | null },
  now: Date,
): boolean {
  return (
    wall.status === 'live' &&
    (wall.startAt === null || wall.startAt <= now) &&
    (wall.endAt === null || wall.endAt > now)
  );
}
export type AutographAssetRole = (typeof autographAssetRoles)[number];
export type AutographAssetStatus = (typeof autographAssetStatuses)[number];
export {
  takeoverAlgorithmVersion,
  pricingCurrency,
  maximumPricingAmountMinor,
  validatePricingConfiguration,
  calculateTakeoverPrice,
  PricingRuleError,
  type PricingConfiguration,
  type PricingSnapshot,
  type PricingCalculation,
} from './pricing';
export {
  wallActions,
  transitionWall,
  validateWallConfiguration,
  validateScheduledConfiguration,
  isPublicWall,
  WallRuleError,
  type WallAction,
  type WallConfiguration,
} from './wall';
export * from './notifications';
