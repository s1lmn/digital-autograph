// @vitest-environment jsdom
import { it, expect, vi, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';
import { NotificationCenter } from './notification-center';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('persists channel/event preferences and clears private inbox on session expiry', async () => {
  let expired = false;
  const request = vi.fn(async (input: string, options?: RequestInit) => {
    if (options?.method === 'PUT') {
      expired = true;
      return new Response('{}', { status: 401 });
    }
    if (expired) return new Response('{}', { status: 401 });
    return new Response(
      JSON.stringify(
        input.endsWith('/preferences')
          ? {
              web: true,
              telegram: false,
              mutedKinds: [],
              telegramLinked: false,
              telegramAvailable: false,
            }
          : [
              {
                id: 'test',
                title: 'Your autograph moved to history',
                detail: null,
                deepLink: '/walls/wall#slot-slot',
                readAt: null,
              },
            ],
      ),
    );
  });
  vi.stubGlobal('fetch', request);
  render(<NotificationCenter apiOrigin="https://api.test" />);
  await screen.findByText('Your autograph moved to history');
  const web = screen.getByRole('checkbox', { name: 'In-app notifications' });
  fireEvent.click(web);
  fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));
  await screen.findByText('Sign in to manage notifications.');
  expect(screen.queryByText('Your autograph moved to history')).toBeNull();
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      'https://api.test/me/notifications/preferences',
      expect.objectContaining({
        method: 'PUT',
        credentials: 'include',
        body: JSON.stringify({ web: false, telegram: false, mutedKinds: [] }),
      }),
    ),
  );
});
