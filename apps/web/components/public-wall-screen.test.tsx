// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { PublicWallScreen } from './public-wall-screen';
import type { PublicWall } from '../lib/public-wall-api';

const origin = 'http://127.0.0.1:4000';
const wallId = '00000000-0000-4000-8000-000000000001';
const slotOne = '00000000-0000-4000-8000-000000000002';
const slotTwo = '00000000-0000-4000-8000-000000000003';
const autographOne = '00000000-0000-4000-8000-000000000004';
const autographTwo = '00000000-0000-4000-8000-000000000005';
const placementId = '00000000-0000-4000-8000-000000000006';

function wall(status: PublicWall['status'] = 'live'): PublicWall {
  return {
    id: wallId,
    status,
    startAt: null,
    endAt: null,
    slotCount: 2,
    creator: {
      id: 'creator-id',
      slug: 'creator',
      displayName: 'Public Creator',
    },
    slots: [
      { id: slotOne, position: 0, occupied: false, currentPlacement: null },
      { id: slotTwo, position: 1, occupied: false, currentPlacement: null },
    ],
  };
}

function occupied(base = wall()): PublicWall {
  return {
    ...base,
    slots: [
      {
        id: slotOne,
        position: 0,
        occupied: true,
        currentPlacement: {
          id: placementId,
          source: 'free_claim',
          startedAt: '2026-09-28T12:00:00.000Z',
          mediaPath: `/public/placements/${placementId}/autograph`,
        },
      },
      base.slots[1]!,
    ],
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function firstUse() {
  return json({
    available: true,
    complete: true,
    adultDeclared: true,
    documents: ['terms_of_use', 'community_guidelines'].map((type) => ({
      type,
      version: 'test-v1',
      hash: 'a'.repeat(64),
      path: `/legal/documents/${type}/test-v1`,
      accepted: true,
    })),
  });
}

function readyList(count = 1) {
  return {
    items: [autographOne, autographTwo].slice(0, count).map((id) => ({
      id,
      source: id === autographOne ? 'canvas' : 'photo',
      createdAt: '2026-09-27T12:00:00.000Z',
      moderatedAt: '2026-09-28T12:00:00.000Z',
    })),
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('public Wall and Free Claim UX', () => {
  it('refreshes history with Refresh Wall inside the single page landmark', async () => {
    let historyRequests = 0;
    const fetchMock = vi.fn(async (input: string) => {
      if (input.endsWith('/legal/first-use')) return firstUse();
      if (input.endsWith('/auth/me')) return json({}, 401);
      if (input.endsWith(`/walls/${wallId}`)) return json(occupied());
      if (input.endsWith('/placements')) {
        historyRequests++;
        return json({
          wallId,
          placements:
            historyRequests === 1
              ? []
              : [
                  {
                    slotPosition: 0,
                    source: 'free_claim',
                    startedAt: '2026-09-28T12:00:00Z',
                    endedAt: null,
                    endReason: null,
                  },
                ],
        });
      }
      throw new Error(`Unexpected request: ${input}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<PublicWallScreen initialWall={wall()} apiOrigin={origin} />);
    expect(
      await screen.findByText('No placements have been recorded yet.'),
    ).toBeTruthy();
    const main = screen.getByRole('main');
    expect(
      screen.getByRole('region', { name: 'Placement history' }).closest('main'),
    ).toBe(main);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Wall' }));
    expect(
      await within(
        screen.getByRole('region', { name: 'Placement history' }),
      ).findByText('Current placement'),
    ).toBeTruthy();
    expect(historyRequests).toBe(2);
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('renders anonymously with occupied media, an unavailable occupied state, and safe sign-in return paths', async () => {
    const fetchMock = vi.fn(async (input: string) =>
      input.endsWith('/placements')
        ? json({ wallId, placements: [] })
        : json({ error: { code: 'UNAUTHENTICATED' } }, 401),
    );
    vi.stubGlobal('fetch', fetchMock);
    const initial = occupied();
    initial.slots[1] = {
      ...initial.slots[1]!,
      occupied: true,
      currentPlacement: {
        id: 'another-placement',
        source: 'admin',
        startedAt: '2026-09-28T12:00:00.000Z',
        mediaPath: null,
      },
    };
    render(<PublicWallScreen initialWall={initial} apiOrigin={origin} />);
    expect(
      screen.getByRole('heading', { name: "Public Creator's Wall" }),
    ).toBeTruthy();
    expect(
      screen.getByAltText('Digital autograph in slot 1').getAttribute('src'),
    ).toBe(`${origin}/public/placements/${placementId}/autograph`);
    expect(screen.getByText('Autograph unavailable')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Sign in to claim' }),
    ).toBeNull();
    fireEvent.error(screen.getByAltText('Digital autograph in slot 1'));
    expect(screen.getAllByText('Autograph unavailable')).toHaveLength(2);

    cleanup();
    render(<PublicWallScreen initialWall={wall()} apiOrigin={origin} />);
    const buttons = await screen.findAllByRole('button', {
      name: 'Sign in to claim',
    });
    fireEvent.click(buttons[0]!);
    expect(
      screen
        .getByRole('link', { name: 'Continue with Google' })
        .getAttribute('href'),
    ).toBe(`${origin}/auth/google/start?returnTo=%2Fwalls%2F${wallId}`);
    expect(
      screen
        .getByRole('link', { name: 'Continue with Telegram' })
        .getAttribute('href'),
    ).toBe(`${origin}/auth/telegram/start?returnTo=%2Fwalls%2F${wallId}`);
  });

  it.each(['scheduled', 'paused', 'ended'] as const)(
    'keeps %s Walls readable without claim controls',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string) =>
          input.endsWith('/placements')
            ? json({ wallId, placements: [] })
            : json({ error: { code: 'UNAUTHENTICATED' } }, 401),
        ),
      );
      render(
        <PublicWallScreen
          initialWall={occupied(wall(status))}
          apiOrigin={origin}
        />,
      );
      expect(screen.getByAltText('Digital autograph in slot 1')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /claim/i })).toBeNull();
      expect(screen.getByText(`Wall status:`).textContent).toContain(status);
    },
  );

  it('keeps a persisted live Wall with an elapsed window read-only in the UI', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        input.endsWith('/placements')
          ? json({ wallId, placements: [] })
          : json({ error: { code: 'UNAUTHENTICATED' } }, 401),
      ),
    );
    const expired = { ...wall(), endAt: '2020-01-01T00:00:00.000Z' };
    render(<PublicWallScreen initialWall={expired} apiOrigin={origin} />);
    expect(screen.getByText('Claims have ended.')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Sign in to claim' }),
    ).toBeNull();
  });

  it('directs an authenticated User with no ready Autographs to creation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input.endsWith('/legal/first-use')) return firstUse();
        if (input.endsWith('/placements'))
          return json({ wallId, placements: [] });
        if (input.endsWith('/auth/me')) return json({ user: { id: 'owner' } });
        if (input.endsWith('/autographs?status=ready'))
          return json({ items: [] });
        throw new Error(`Unexpected request: ${input}`);
      }),
    );
    render(<PublicWallScreen initialWall={wall()} apiOrigin={origin} />);
    expect(
      await screen.findByRole('link', {
        name: 'Create your digital autograph',
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Claim this slot' }),
    ).toBeNull();
    expect(
      screen.queryByRole('link', { name: 'Continue with Google' }),
    ).toBeNull();
  });

  it('selects a ready Autograph, waits for confirmation, then refreshes the claimed Slot on 201', async () => {
    let historyRequests = 0;
    let completeClaim!: (response: Response) => void;
    const delayed = new Promise<Response>((resolve) => {
      completeClaim = resolve;
    });
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.endsWith('/legal/first-use')) return firstUse();
      if (input.endsWith('/placements')) {
        historyRequests++;
        return json({
          wallId,
          placements:
            historyRequests === 1
              ? []
              : [
                  {
                    slotPosition: 0,
                    source: 'free_claim',
                    startedAt: '2026-09-28T12:00:00Z',
                    endedAt: null,
                    endReason: null,
                  },
                ],
        });
      }
      if (input.endsWith('/auth/me')) return json({ user: { id: 'owner' } });
      if (input.endsWith('/autographs?status=ready')) return json(readyList(2));
      if (input.includes('/preview')) {
        const id = input.split('/')[4];
        return json({
          assetId: 'private-id',
          url: `https://private.example/${id}`,
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
        });
      }
      if (input.endsWith('/free-claim')) return delayed;
      if (input.endsWith(`/walls/${wallId}`)) return json(occupied());
      throw new Error(`Unexpected request: ${input} ${init?.method}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<PublicWallScreen initialWall={wall()} apiOrigin={origin} />);
    expect(
      await screen.findByText('No placements have been recorded yet.'),
    ).toBeTruthy();
    const radios = await screen.findAllByRole('radio');
    fireEvent.click(radios[1]!);
    await waitFor(() =>
      expect(
        screen
          .getByAltText('Private preview of your selected digital autograph')
          .getAttribute('src'),
      ).toBe(`https://private.example/${autographTwo}`),
    );
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Claim this slot' })[0]!,
    );
    expect(await screen.findByText(/free claim is not restored/i)).toBeTruthy();
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith('/free-claim'),
      ),
    ).toHaveLength(0);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Confirm free claim' }),
    );
    expect(
      await screen.findByRole('button', { name: 'Claiming…' }),
    ).toHaveProperty('disabled', true);
    const mutation = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/free-claim'),
    );
    expect(JSON.parse(String(mutation?.[1]?.body))).toEqual({
      autographId: autographTwo,
    });
    completeClaim(
      json(
        {
          claimId: 'claim',
          wallId,
          slotId: slotOne,
          autographId: autographTwo,
          placement: {
            id: placementId,
            source: 'free_claim',
            startedAt: '2026-09-28T12:00:00Z',
          },
        },
        201,
      ),
    );
    expect(
      await screen.findByText('Your autograph is on the Wall.'),
    ).toBeTruthy();
    expect(
      await screen.findByAltText('Digital autograph in slot 1'),
    ).toBeTruthy();
    expect(
      await within(
        screen.getByRole('region', { name: 'Placement history' }),
      ).findByText('Current placement'),
    ).toBeTruthy();
    expect(historyRequests).toBe(2);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith(`/walls/${wallId}`),
      ),
    ).toBe(true);
  });

  it('treats exact replay 200 as success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input.endsWith('/legal/first-use')) return firstUse();
        if (input.endsWith('/placements'))
          return json({ wallId, placements: [] });
        if (input.endsWith('/auth/me')) return json({ user: { id: 'owner' } });
        if (input.endsWith('/autographs?status=ready'))
          return json(readyList());
        if (input.includes('/preview'))
          return json({
            assetId: 'private-id',
            url: 'https://private.example/one',
            expiresAt: new Date(Date.now() + 120_000).toISOString(),
          });
        if (input.endsWith('/free-claim'))
          return json({ claimId: 'claim' }, 200);
        if (input.endsWith(`/walls/${wallId}`)) return json(occupied());
        throw new Error(`Unexpected request: ${input}`);
      }),
    );
    render(<PublicWallScreen initialWall={wall()} apiOrigin={origin} />);
    fireEvent.click(
      (await screen.findAllByRole('button', { name: 'Claim this slot' }))[0]!,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Confirm free claim' }),
    );
    expect(
      await screen.findByText('Your autograph is on the Wall.'),
    ).toBeTruthy();
    expect(
      await screen.findByAltText('Digital autograph in slot 1'),
    ).toBeTruthy();
  });

  it('handles a Slot race by refreshing without claiming another Slot', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.endsWith('/legal/first-use')) return firstUse();
      if (input.endsWith('/placements'))
        return json({ wallId, placements: [] });
      if (input.endsWith('/auth/me')) return json({ user: { id: 'owner' } });
      if (input.endsWith('/autographs?status=ready')) return json(readyList());
      if (input.includes('/preview'))
        return json({
          assetId: 'private-id',
          url: 'https://private.example/one',
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
        });
      if (input.endsWith('/free-claim'))
        return json({ error: { code: 'SLOT_OCCUPIED' } }, 409);
      if (input.endsWith(`/walls/${wallId}`)) return json(occupied());
      throw new Error(`Unexpected request: ${input}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<PublicWallScreen initialWall={wall()} apiOrigin={origin} />);
    fireEvent.click(
      (await screen.findAllByRole('button', { name: 'Claim this slot' }))[0]!,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Confirm free claim' }),
    );
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('Someone claimed this slot first'),
    );
    expect(
      await screen.findByAltText('Digital autograph in slot 1'),
    ).toBeTruthy();
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith('/free-claim'),
      ),
    ).toHaveLength(1);
  });

  it('disables further attempts after FREE_CLAIM_ALREADY_USED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input.endsWith('/legal/first-use')) return firstUse();
        if (input.endsWith('/placements'))
          return json({ wallId, placements: [] });
        if (input.endsWith('/auth/me')) return json({ user: { id: 'owner' } });
        if (input.endsWith('/autographs?status=ready'))
          return json(readyList());
        if (input.includes('/preview'))
          return json({
            assetId: 'private-id',
            url: 'https://private.example/one',
            expiresAt: new Date(Date.now() + 120_000).toISOString(),
          });
        if (input.endsWith('/free-claim'))
          return json({ error: { code: 'FREE_CLAIM_ALREADY_USED' } }, 409);
        throw new Error(`Unexpected request: ${input}`);
      }),
    );
    render(<PublicWallScreen initialWall={wall()} apiOrigin={origin} />);
    fireEvent.click(
      (await screen.findAllByRole('button', { name: 'Claim this slot' }))[0]!,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Confirm free claim' }),
    );
    expect(
      await screen.findByText(
        'Your one free claim on this Wall has already been used.',
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Claim this slot' }),
    ).toBeNull();
  });

  it('disables claim controls when the server says the Wall is no longer claimable', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.endsWith('/legal/first-use')) return firstUse();
      if (input.endsWith('/placements'))
        return json({ wallId, placements: [] });
      if (input.endsWith('/auth/me')) return json({ user: { id: 'owner' } });
      if (input.endsWith('/autographs?status=ready')) return json(readyList());
      if (input.includes('/preview'))
        return json({
          assetId: 'private-id',
          url: 'https://private.example/one',
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
        });
      if (input.endsWith('/free-claim'))
        return json({ error: { code: 'WALL_NOT_CLAIMABLE' } }, 409);
      if (input.endsWith(`/walls/${wallId}`)) return json(wall('paused'));
      throw new Error(`Unexpected request: ${input}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<PublicWallScreen initialWall={wall()} apiOrigin={origin} />);
    fireEvent.click(
      (await screen.findAllByRole('button', { name: 'Claim this slot' }))[0]!,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Confirm free claim' }),
    );
    expect(
      await screen.findByText(
        'This Wall is no longer available for free claims.',
      ),
    ).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText('Wall status:').textContent).toContain('paused'),
    );
    expect(
      screen.queryByRole('button', { name: 'Claim this slot' }),
    ).toBeNull();
  });
});

it('retries failed auth and ready list reads before showing claim actions', async () => {
  let sessionReads = 0;
  let readyReads = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      if (input.endsWith('/legal/first-use')) return firstUse();
      if (input.endsWith('/placements'))
        return json({ wallId, placements: [] });
      if (input.endsWith('/auth/me')) {
        sessionReads++;
        if (sessionReads === 1) throw new TypeError('offline');
        return json({ user: {} });
      }
      if (input.endsWith('/autographs?status=ready')) {
        readyReads++;
        if (readyReads === 1) return json({}, 503);
        return json(readyList());
      }
      if (input.endsWith('/preview'))
        return json({
          url: 'https://private.example/preview',
          assetId: 'private',
          expiresAt: new Date(Date.now() + 120000).toISOString(),
        });
      throw new Error('Unexpected request');
    }),
  );
  render(<PublicWallScreen initialWall={wall()} apiOrigin={origin} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Retry sign-in check' }),
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Retry ready autographs' }),
  );
  expect(
    await screen.findAllByRole('button', { name: 'Claim this slot' }),
  ).toHaveLength(2);
  expect(readyReads).toBe(2);
});

it.each([
  'WALL_NOT_FOUND',
  'SLOT_NOT_FOUND',
  'SLOT_NOT_IN_WALL',
  'AUTOGRAPH_NOT_FOUND',
])('explains %s without sending another claim', async (code) => {
  const fetchMock = vi.fn(async (input: string) => {
    if (input.endsWith('/legal/first-use')) return firstUse();
    if (input.endsWith('/placements')) return json({ wallId, placements: [] });
    if (input.endsWith('/auth/me')) return json({ user: {} });
    if (input.endsWith('/autographs?status=ready')) return json(readyList());
    if (input.endsWith('/preview'))
      return json({
        assetId: 'private',
        url: 'https://private.example/preview',
        expiresAt: new Date(Date.now() + 120000).toISOString(),
      });
    if (input.endsWith('/free-claim')) return json({ error: { code } }, 404);
    if (input.endsWith(`/walls/${wallId}`)) return json(wall());
    throw new Error('Unexpected request');
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<PublicWallScreen initialWall={wall()} apiOrigin={origin} />);
  fireEvent.click(
    (await screen.findAllByRole('button', { name: 'Claim this slot' }))[0]!,
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Confirm free claim' }),
  );
  expect(
    await screen.findByText(
      code === 'AUTOGRAPH_NOT_FOUND'
        ? 'That autograph is no longer ready. Choose another ready autograph.'
        : 'This Wall or slot is no longer available. Refresh the Wall to choose an available slot.',
    ),
  ).toBeTruthy();
  expect(
    fetchMock.mock.calls.filter(([url]) => url.endsWith('/free-claim')),
  ).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Retry same claim' })).toBeNull();
});
