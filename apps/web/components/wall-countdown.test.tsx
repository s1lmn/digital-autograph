// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { countdownLabel, WallCountdown } from './wall-countdown';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('updates a display-only countdown and never goes negative after the deadline', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
  render(
    <WallCountdown status="live" startAt={null} endAt="2026-10-02T12:00:02Z" />,
  );
  expect(screen.getByText('0h 0m 2s')).toBeTruthy();
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByText('0h 0m 1s')).toBeTruthy();
  act(() => vi.advanceTimersByTime(5000));
  expect(screen.getByText('0h 0m 0s')).toBeTruthy();
  expect(
    screen.getByText(/availability is checked when you confirm/),
  ).toBeTruthy();
  expect(
    countdownLabel('2026-10-03T13:02:03Z', Date.parse('2026-10-02T12:00:00Z')),
  ).toBe('1d 1h 2m 3s');
});
it('shows scheduled start time but does not imply paused or ended Walls can be claimed', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
  const { rerender } = render(
    <WallCountdown
      status="scheduled"
      startAt="2026-10-02T13:00:00Z"
      endAt={null}
    />,
  );
  expect(screen.getByText(/Starts in/)).toBeTruthy();
  rerender(
    <WallCountdown
      status="paused"
      startAt={null}
      endAt="2026-10-03T12:00:00Z"
    />,
  );
  expect(screen.queryByText(/Ends in/)).toBeNull();
});
