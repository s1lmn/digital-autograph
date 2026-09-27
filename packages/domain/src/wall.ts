import type { WallStatus } from './index';

export const wallActions = [
  'schedule',
  'unschedule',
  'publish',
  'pause',
  'resume',
  'end',
  'archive',
] as const;

export type WallAction = (typeof wallActions)[number];

export type WallConfiguration = {
  startAt: Date | null;
  endAt: Date | null;
};

export class WallRuleError extends Error {
  constructor(
    readonly code: 'INVALID_WALL_TRANSITION' | 'INVALID_WALL_CONFIGURATION',
  ) {
    super(code);
  }
}

const transitions: Record<
  WallStatus,
  Partial<Record<WallAction, WallStatus>>
> = {
  draft: { schedule: 'scheduled', publish: 'live' },
  scheduled: { unschedule: 'draft', publish: 'live' },
  live: { pause: 'paused', end: 'ended' },
  paused: { resume: 'live', end: 'ended' },
  ended: { archive: 'archived' },
  archived: {},
};

export function validateWallConfiguration(config: WallConfiguration): void {
  const { startAt, endAt } = config;
  if (
    (startAt !== null && !Number.isFinite(startAt.getTime())) ||
    (endAt !== null && !Number.isFinite(endAt.getTime())) ||
    (startAt !== null && endAt !== null && endAt <= startAt)
  ) {
    throw new WallRuleError('INVALID_WALL_CONFIGURATION');
  }
}

export function transitionWall(
  current: WallStatus,
  action: WallAction,
  config: WallConfiguration,
  now: Date,
): WallStatus {
  const next = transitions[current][action];
  if (!next) throw new WallRuleError('INVALID_WALL_TRANSITION');
  validateWallConfiguration(config);
  if (next === 'scheduled' && (!config.startAt || config.startAt <= now)) {
    throw new WallRuleError('INVALID_WALL_CONFIGURATION');
  }
  if (
    next === 'live' &&
    ((config.startAt !== null && config.startAt > now) ||
      (config.endAt !== null && config.endAt <= now))
  ) {
    throw new WallRuleError('INVALID_WALL_CONFIGURATION');
  }
  return next;
}

export function validateScheduledConfiguration(
  config: WallConfiguration,
  now: Date,
): void {
  validateWallConfiguration(config);
  if (!config.startAt || config.startAt <= now) {
    throw new WallRuleError('INVALID_WALL_CONFIGURATION');
  }
}

export function isPublicWall(status: WallStatus): boolean {
  return (
    status === 'scheduled' ||
    status === 'live' ||
    status === 'paused' ||
    status === 'ended'
  );
}
