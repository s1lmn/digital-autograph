// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import {
  FirstUseActionNotice,
  needsFirstUseConfirmation,
} from './first-use-action-notice';
it('offers exact local re-consent navigation without discarding the original action', () => {
  expect(needsFirstUseConfirmation({ code: 'FIRST_USE_REQUIRED' })).toBe(true);
  expect(needsFirstUseConfirmation({ code: 'UPLOAD_FAILED' })).toBe(false);
  expect(needsFirstUseConfirmation(null)).toBe(false);
  render(<FirstUseActionNotice returnTo="/autograph/create" />);
  const link = screen.getByRole('link', {
    name: 'Открыть подтверждения в новой вкладке',
  });
  expect(link.getAttribute('href')).toBe(
    '/legal/first-use?returnTo=%2Fautograph%2Fcreate',
  );
  expect(link.getAttribute('target')).toBe('_blank');
  expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  cleanup();
});
