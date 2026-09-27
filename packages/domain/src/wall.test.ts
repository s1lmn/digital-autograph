import { describe, expect, it } from 'vitest';
import {
  transitionWall,
  validateScheduledConfiguration,
  validateWallConfiguration,
  WallRuleError,
} from './wall';

const now = new Date('2026-09-27T12:00:00.000Z');
const future = new Date('2026-09-28T12:00:00.000Z');
const past = new Date('2026-09-26T12:00:00.000Z');

describe('Wall lifecycle', () => {
  it('allows each explicit transition and rejects others', () => {
    const config = { startAt: null, endAt: null };
    expect(transitionWall('draft', 'publish', config, now)).toBe('live');
    expect(transitionWall('live', 'pause', config, now)).toBe('paused');
    expect(transitionWall('paused', 'resume', config, now)).toBe('live');
    expect(transitionWall('live', 'end', config, now)).toBe('ended');
    expect(transitionWall('paused', 'end', config, now)).toBe('ended');
    expect(transitionWall('ended', 'archive', config, now)).toBe('archived');
    expect(() => transitionWall('archived', 'publish', config, now)).toThrow(
      WallRuleError,
    );
    expect(() => transitionWall('draft', 'pause', config, now)).toThrow(
      WallRuleError,
    );
  });

  it('requires a future start for scheduling and an active window for publishing', () => {
    expect(
      transitionWall(
        'draft',
        'schedule',
        { startAt: future, endAt: null },
        now,
      ),
    ).toBe('scheduled');
    expect(
      transitionWall(
        'scheduled',
        'unschedule',
        { startAt: future, endAt: null },
        now,
      ),
    ).toBe('draft');
    expect(
      transitionWall(
        'scheduled',
        'publish',
        { startAt: past, endAt: null },
        now,
      ),
    ).toBe('live');
    expect(() =>
      transitionWall('draft', 'schedule', { startAt: past, endAt: null }, now),
    ).toThrow(WallRuleError);
    expect(() =>
      transitionWall(
        'scheduled',
        'publish',
        { startAt: future, endAt: null },
        now,
      ),
    ).toThrow(WallRuleError);
    expect(() =>
      transitionWall('paused', 'resume', { startAt: past, endAt: now }, now),
    ).toThrow(WallRuleError);
    expect(() =>
      validateScheduledConfiguration({ startAt: past, endAt: null }, now),
    ).toThrow(WallRuleError);
  });

  it('rejects invalid wall time ranges', () => {
    expect(() =>
      validateWallConfiguration({ startAt: now, endAt: now }),
    ).toThrow(WallRuleError);
  });
});
