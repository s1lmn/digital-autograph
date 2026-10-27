// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WallSlot } from './wall-slot';
import { frontendCapabilities } from '../lib/frontend-capabilities';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('keeps paid takeover disabled without requests, and retries failed public media', () => {
  const onAction = vi.fn();
  render(
    <ul>
      <WallSlot
        apiOrigin="https://api.example.test"
        onAction={onAction}
        slot={{
          id: 'slot',
          position: 0,
          occupied: true,
          currentPlacement: {
            id: 'placement',
            source: 'free_claim',
            startedAt: '2026-10-02T12:00:00Z',
            mediaPath: '/public/placements/placement/autograph',
          },
        }}
      />
    </ul>,
  );
  expect(frontendCapabilities).toEqual({
    paidTakeover: false,
    creatorDashboard: false,
    notifications: true,
  });
  const paid = screen.getByRole('button', { name: 'Paid takeover' });
  expect(paid).toHaveProperty('disabled', true);
  fireEvent.click(paid);
  expect(onAction).not.toHaveBeenCalled();
  fireEvent.error(screen.getByRole('img'));
  expect(screen.getByText('Autograph unavailable')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry autograph' }));
  expect(screen.getByRole('img').getAttribute('src')).toBe(
    'https://api.example.test/public/placements/placement/autograph',
  );
});

it('offers a retry when SSR media failed before hydration attached its error handler', () => {
  const complete = vi
    .spyOn(HTMLImageElement.prototype, 'complete', 'get')
    .mockReturnValue(true);
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(
    0,
  );
  const onAction = vi.fn();
  render(
    <ul>
      <WallSlot
        apiOrigin="https://api.example.test"
        onAction={onAction}
        slot={{
          id: 'slot',
          position: 0,
          occupied: true,
          currentPlacement: {
            id: 'placement',
            source: 'free_claim',
            startedAt: '2026-10-02T12:00:00Z',
            mediaPath: '/public/placements/placement/autograph',
          },
        }}
      />
    </ul>,
  );
  expect(screen.getByText('Autograph unavailable')).toBeTruthy();
  complete.mockReturnValue(false);
  fireEvent.click(screen.getByRole('button', { name: 'Retry autograph' }));
  expect(screen.getByRole('img').getAttribute('src')).toBe(
    'https://api.example.test/public/placements/placement/autograph',
  );
  expect(screen.queryByRole('button', { name: 'Claim this slot' })).toBeNull();
  expect(onAction).not.toHaveBeenCalled();
});
