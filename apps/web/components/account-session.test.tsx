// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AccountSession } from './account-session';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('retries a failed session read and never displays private user fields', async () => {
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ user: { id: 'private-id' } })),
    );
  vi.stubGlobal('fetch', fetchMock);
  render(<AccountSession apiOrigin="https://api.example.test" />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry sign-in check' }));
  expect(
    await screen.findByRole('heading', { name: 'You are signed in' }),
  ).toBeTruthy();
  expect(screen.queryByText('private-id')).toBeNull();
  expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
    credentials: 'include',
    cache: 'no-store',
  });
});

it('guards duplicate logout, retains authenticated state after failure and offers a safe retry', async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response('{}'))
    .mockResolvedValueOnce(pending)
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  render(<AccountSession apiOrigin="https://api.example.test" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
  const waiting = screen.getByRole('button', { name: 'Signing out…' });
  expect(waiting).toHaveProperty('disabled', true);
  fireEvent.click(waiting);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  finish(new Response(null, { status: 503 }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Retry sign out' }),
  );
  expect(
    await screen.findByRole('heading', { name: 'Sign in to continue' }),
  ).toBeTruthy();
  expect(fetchMock.mock.calls[2]?.[0]).toBe(
    'https://api.example.test/auth/logout',
  );
  expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
    method: 'POST',
    credentials: 'include',
  });
  expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
});
