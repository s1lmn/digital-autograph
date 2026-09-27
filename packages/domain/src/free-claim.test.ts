import { describe, expect, it } from 'vitest';
import { isWallFreeClaimEligible } from './index';

describe('Free Claim Wall time rule', () => {
  const now = new Date('2026-09-28T12:00:00.000Z');

  it('includes start and excludes end at the exact boundary', () => {
    expect(
      isWallFreeClaimEligible(
        { status: 'live', startAt: now, endAt: null },
        now,
      ),
    ).toBe(true);
    expect(
      isWallFreeClaimEligible(
        { status: 'live', startAt: null, endAt: now },
        now,
      ),
    ).toBe(false);
  });

  it('requires live status and valid time interval', () => {
    expect(
      isWallFreeClaimEligible(
        { status: 'live', startAt: null, endAt: null },
        now,
      ),
    ).toBe(true);
    expect(
      isWallFreeClaimEligible(
        { status: 'live', startAt: new Date(now.getTime() + 1), endAt: null },
        now,
      ),
    ).toBe(false);
    for (const status of [
      'draft',
      'scheduled',
      'paused',
      'ended',
      'archived',
    ] as const) {
      expect(
        isWallFreeClaimEligible({ status, startAt: null, endAt: null }, now),
      ).toBe(false);
    }
  });
});
