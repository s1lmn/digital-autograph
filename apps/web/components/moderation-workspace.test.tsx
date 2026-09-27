// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ModerationWorkspace } from './moderation-workspace';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const item = {
  id: 'autograph-1',
  source: 'canvas',
  approvedAt: '2026-09-28T00:00:00Z',
  createdAt: '2026-09-27T00:00:00Z',
};
const preview = {
  url: 'https://private.test/signed',
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
};
function response(value: object, status = 200) {
  return { ok: status < 400, status, json: async () => value };
}

describe('moderation workspace', () => {
  it('shows backend forbidden result instead of controls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ error: { code: 'FORBIDDEN' } }, 403)),
    );
    render(<ModerationWorkspace apiOrigin="http://api.test" />);
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Forbidden: a platform moderator or admin role is required.',
    );
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('requires a loaded private preview and rejection reason, then removes the decided item', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ items: [item], nextCursor: null }))
      .mockResolvedValueOnce(response(preview))
      .mockResolvedValueOnce(
        response({
          id: item.id,
          status: 'moderation_rejected',
          decision: 'rejected',
          reasonCode: 'NOT_AN_AUTOGRAPH',
          decidedAt: 'now',
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    render(<ModerationWorkspace apiOrigin="http://api.test" />);
    fireEvent.click(await screen.findByRole('button', { name: /canvas ·/ }));
    const reject = screen.getByRole('button', { name: 'Reject' });
    expect(reject.hasAttribute('disabled')).toBe(true);
    const image = await screen.findByAltText(
      'Private cleaned autograph for moderation',
    );
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
    fireEvent.load(image);
    expect(reject.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Rejection reason'), {
      target: { value: 'NOT_AN_AUTOGRAPH' },
    });
    expect(reject.hasAttribute('disabled')).toBe(false);
    fireEvent.click(reject);
    expect(
      await screen.findByText('Rejected. The owner can see the reason code.'),
    ).toBeTruthy();
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({
        decision: 'rejected',
        reasonCode: 'NOT_AN_AUTOGRAPH',
      }),
    });
    expect(screen.queryByRole('button', { name: /canvas ·/ })).toBeNull();
    expect(
      screen.queryByAltText('Private cleaned autograph for moderation'),
    ).toBeNull();
  });

  it('prevents duplicate approval requests and retries after an uncertain network failure', async () => {
    let resolveFirst!: (value: unknown) => void;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ items: [item], nextCursor: null }))
      .mockResolvedValueOnce(response(preview))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(
        response({
          id: item.id,
          status: 'ready',
          decision: 'approved',
          reasonCode: null,
          decidedAt: 'now',
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    render(<ModerationWorkspace apiOrigin="http://api.test" />);
    fireEvent.click(await screen.findByRole('button', { name: /canvas ·/ }));
    fireEvent.load(
      await screen.findByAltText('Private cleaned autograph for moderation'),
    );
    const approve = screen.getByRole('button', { name: 'Approve' });
    fireEvent.click(approve);
    fireEvent.click(approve);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(approve.hasAttribute('disabled')).toBe(true);
    resolveFirst(response({ error: { code: 'REQUEST_FAILED' } }, 503));
    expect(
      await screen.findByText('Decision could not be confirmed. Retry safely.'),
    ).toBeTruthy();
    fireEvent.click(approve);
    expect(
      await screen.findByText(
        'Approved. The autograph is ready but remains private.',
      ),
    ).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({
      body: JSON.stringify({ decision: 'approved' }),
    });
  });
});
