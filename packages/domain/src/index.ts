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

export type UserStatus = (typeof userStatuses)[number];
export type WallStatus = (typeof wallStatuses)[number];
export type PlacementSource = (typeof placementSources)[number];
export type AdministrativeRole = (typeof administrativeRoles)[number];
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
