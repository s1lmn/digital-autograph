// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CanvasAuthGate } from './canvas-auth-gate';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CanvasAuthGate', () => {
  it('uses the API session cookie and offers fixed return-path login links to anonymous users', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<CanvasAuthGate apiOrigin="http://127.0.0.1:4000" />);
    expect(
      await screen.findByRole('heading', { name: 'Sign in to continue' }),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4000/auth/me',
      expect.objectContaining({ credentials: 'include', cache: 'no-store' }),
    );
    expect(
      screen
        .getByRole('link', { name: 'Continue with Google' })
        .getAttribute('href'),
    ).toBe(
      'http://127.0.0.1:4000/auth/google/start?returnTo=%2Fautograph%2Fcreate',
    );
  });
});
