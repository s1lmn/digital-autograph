import { describe, expect, it } from 'vitest';
import { autographStatuses, isAutographPlacementEligible } from './index';

describe('Autograph placement status predicate', () => {
  it('allows only ready', () => {
    for (const status of autographStatuses) {
      expect(isAutographPlacementEligible(status)).toBe(status === 'ready');
    }
  });
});
