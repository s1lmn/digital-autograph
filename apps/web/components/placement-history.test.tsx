// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import styles from './placement-history.module.css';
import {
  UserPlacementHistory,
  WallPlacementHistory,
} from './placement-history';

const origin = 'http://127.0.0.1:4000';
const wallId = '00000000-0000-4000-8000-000000000002';
const placement = {
  wallId,
  wallSlug: 'public-creator',
  wallDisplayName: 'Public Creator',
  wallIsPublic: true,
  slotPosition: 0,
  source: 'free_claim',
  startedAt: '2026-09-28T12:00:00.000Z',
  endedAt: null,
  endReason: null,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Placement history UI', () => {
  it('keeps archived Wall placements visible without a dead public link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input.endsWith('/auth/me'))
          return json({ user: { id: 'private' } });
        if (input.endsWith('/me/placements'))
          return json({ items: [{ ...placement, wallIsPublic: false }] });
        throw new Error(`Unexpected request: ${input}`);
      }),
    );
    render(<UserPlacementHistory apiOrigin={origin} />);
    expect(
      await screen.findByRole('heading', { name: "Public Creator's Wall" }),
    ).toBeTruthy();
    expect(screen.getByText('Current placement')).toBeTruthy();
    expect(
      screen.queryByRole('link', { name: "Public Creator's Wall" }),
    ).toBeNull();
    expect(screen.getByRole('list').className).toBe(styles.historyList);
  });

  it('shows safe public Wall history and the current Free Claim', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.endsWith(`/walls/${wallId}/placements`)) {
        return json({
          wallId,
          placements: [
            {
              slotPosition: 0,
              source: 'free_claim',
              startedAt: placement.startedAt,
              endedAt: null,
              endReason: null,
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${input}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<WallPlacementHistory wallId={wallId} apiOrigin={origin} />);

    expect(await screen.findByText('Free Claim')).toBeTruthy();
    expect(screen.getByText('Current placement')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Slot 1' })).toBeTruthy();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${origin}/walls/${wallId}/placements`,
    );
  });

  it('shows only authenticated User history and gives anonymous visitors provider return links', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.endsWith('/auth/me')) return json({ user: { id: 'private' } });
      if (input.endsWith('/me/placements')) return json({ items: [placement] });
      throw new Error(`Unexpected request: ${input}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<UserPlacementHistory apiOrigin={origin} />);

    expect(
      await screen.findByRole('link', { name: "Public Creator's Wall" }),
    ).toHaveProperty('href', `${window.location.origin}/walls/${wallId}`);
    expect(screen.getByText('Free Claim')).toBeTruthy();
    expect(screen.getByRole('list').className).toBe(styles.historyList);
    expect(screen.queryByText('private')).toBeNull();

    cleanup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        input.endsWith('/auth/me')
          ? json({ error: { code: 'UNAUTHENTICATED' } }, 401)
          : json({}),
      ),
    );
    render(<UserPlacementHistory apiOrigin={origin} />);
    expect(
      await screen.findByRole('link', { name: 'Continue with Google' }),
    ).toHaveProperty(
      'href',
      `${origin}/auth/google/start?returnTo=%2Fme%2Fplacements`,
    );
  });

  it('identifies when the personal history reaches its result limit', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.endsWith('/auth/me')) return json({ user: { id: 'private' } });
      if (input.endsWith('/me/placements')) {
        return json({
          items: Array.from({ length: 100 }, (_, index) => ({
            ...placement,
            startedAt: new Date(
              Date.UTC(2026, 8, 30, 12, 0, index),
            ).toISOString(),
          })),
        });
      }
      throw new Error(`Unexpected request: ${input}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<UserPlacementHistory apiOrigin={origin} />);

    expect(
      await screen.findByText('Showing your 100 most recent placements.'),
    ).toBeTruthy();
  });
});

it('retries public history safely after an offline read', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(json({ wallId, placements: [] })),
  );
  render(<WallPlacementHistory wallId={wallId} apiOrigin={origin} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Retry Wall history' }),
  );
  expect(
    await screen.findByText('No placements have been recorded yet.'),
  ).toBeTruthy();
});

it('clears personal history when the session expires between session check and history read', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(json({ user: { id: 'private' } }))
      .mockResolvedValueOnce(json({ error: { code: 'UNAUTHENTICATED' } }, 401)),
  );
  render(<UserPlacementHistory apiOrigin={origin} />);
  expect(
    await screen.findByText('Sign in to view your placement history.'),
  ).toBeTruthy();
  expect(screen.queryByText('Current placement')).toBeNull();
});

it('rechecks authentication and retries personal history after a failed read', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(json({ user: {} }))
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(json({ user: {} }))
      .mockResolvedValueOnce(json({ items: [placement] })),
  );
  render(<UserPlacementHistory apiOrigin={origin} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Retry your history' }),
  );
  expect(await screen.findByText('Current placement')).toBeTruthy();
});
