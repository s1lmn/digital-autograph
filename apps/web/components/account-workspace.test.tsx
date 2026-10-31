// @vitest-environment jsdom
import { afterEach, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { AccountWorkspace } from './account-workspace';
import { WorkspaceNavigation } from './workspace-navigation';
vi.mock('next/navigation', () => ({ usePathname: () => '/me' }));
const data = {
  profile: { id: 'creator', displayName: 'My studio', slug: 'my-studio' },
  autographs: [
    {
      id: 'own',
      source: 'canvas',
      status: 'awaiting_moderation',
      createdAt: '2026-10-30T12:00:00Z',
    },
  ],
  walls: [],
  canModerate: false,
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('shows existing autograph status without creating a replacement or exposing original keys', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(data)));
  vi.stubGlobal('fetch', fetcher);
  render(
    <AccountWorkspace
      apiOrigin="https://api.example.test"
      section="autographs"
    />,
  );
  expect(await screen.findByText('Awaiting moderation')).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Open private preview' }),
  ).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  });
});
it('keeps preferences out of the menu and supports closing with Escape', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify(data))),
  );
  render(<WorkspaceNavigation apiOrigin="https://api.example.test" />);
  expect(await screen.findByText('My studio')).toBeTruthy();
  const toggle = screen.getByRole('button', { name: 'Menu' });
  fireEvent.click(toggle);
  expect(screen.getByRole('link', { name: 'Settings' })).toBeTruthy();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.queryByRole('link', { name: 'Moderation' })).toBeNull();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('navigation')).toBeNull();
  expect(document.activeElement).toBe(toggle);
});
it('does not advertise creating an autograph to a guest', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('{}', { status: 401 })),
  );
  render(<WorkspaceNavigation apiOrigin="https://api.example.test" />);
  fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
  expect(screen.queryByRole('link', { name: 'Create autograph' })).toBeNull();
  expect(
    screen
      .getByRole('link', { name: 'Sign in to continue' })
      .getAttribute('href'),
  ).toBe('/me');
});
it('creates a draft explicitly and does not publish it or duplicate a pending request', async () => {
  let finish!: (r: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ...data, autographs: [] })),
    )
    .mockReturnValueOnce(pending)
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...data,
          walls: [
            {
              id: 'draft-wall',
              status: 'draft',
              slotCount: 12,
              createdAt: '2026-10-31T09:00:00Z',
            },
          ],
        }),
      ),
    );
  vi.stubGlobal('fetch', fetcher);
  render(
    <AccountWorkspace apiOrigin="https://api.example.test" section="walls" />,
  );
  fireEvent.change(await screen.findByLabelText('Number of places'), {
    target: { value: '12' },
  });
  const create = screen.getByRole('button', { name: 'Create draft Wall' });
  fireEvent.click(create);
  fireEvent.click(create);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1]?.[0]).toBe(
    'https://api.example.test/creators/creator/walls',
  );
  expect(JSON.parse(fetcher.mock.calls[1]?.[1].body)).toEqual({
    slotCount: 12,
  });
  finish(new Response('{}', { status: 201 }));
  expect(
    await screen.findByRole('button', { name: 'Publish Wall' }),
  ).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Open Wall' })).toBeNull();
});
it.each([
  ['ready', 'Approved'],
  ['moderation_rejected', 'Rejected'],
])(
  'opens the private preview action for backend status %s',
  async (status, label) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...data,
            autographs: [{ ...data.autographs[0], status }],
          }),
        ),
      ),
    );
    render(
      <AccountWorkspace
        apiOrigin="https://api.example.test"
        section="autographs"
      />,
    );
    expect(await screen.findByText(label)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Open private preview' }),
    ).toBeTruthy();
  },
);
