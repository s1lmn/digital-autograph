// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { CleanedAutographReview } from './cleaned-autograph-review';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const initialPreview = {
  assetId: 'cleaned-asset-id',
  url: 'https://private.test/preview',
  expiresAt: '2026-09-27T00:00:00Z',
};

describe('cleaned autograph approval UI', () => {
  it('requires the image to load, prevents duplicate approval, and shows moderation pending', async () => {
    let resolveApproval!: (value: {
      status: 'awaiting_moderation';
      approvedAt: string;
    }) => void;
    const approve = vi.fn(
      () =>
        new Promise<{ status: 'awaiting_moderation'; approvedAt: string }>(
          (resolve) => {
            resolveApproval = resolve;
          },
        ),
    );
    const api = { approve, preview: vi.fn(async () => initialPreview) };
    render(
      <CleanedAutographReview
        api={api}
        autographId="autograph-1"
        initialPreview={initialPreview}
        onStartOver={vi.fn()}
      />,
    );
    const button = screen.getByRole('button', {
      name: 'Approve and submit for moderation',
    });
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.load(screen.getByAltText('Cleaned digital autograph preview'));
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);
    fireEvent.click(
      screen.getByRole('button', { name: 'Submitting approval…' }),
    );
    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve).toHaveBeenCalledWith(
      'autograph-1',
      'cleaned-asset-id',
      expect.any(AbortSignal),
    );
    expect(
      screen
        .getByRole('button', { name: 'Submitting approval…' })
        .hasAttribute('disabled'),
    ).toBe(true);
    resolveApproval({
      status: 'awaiting_moderation',
      approvedAt: '2026-09-27T00:00:00Z',
    });
    expect(await screen.findByText('Submitted for moderation')).toBeTruthy();
    expect(
      screen.getByText(
        'Your approval is recorded. No public placement has occurred yet.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Claim Slot/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
  });

  it('offers safe retry after a network error and retains start-over and refresh', async () => {
    const approve = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({
        status: 'awaiting_moderation',
        approvedAt: '2026-09-27T00:00:00Z',
      });
    const preview = vi.fn(async () => ({
      ...initialPreview,
      url: 'https://private.test/new-preview',
    }));
    const onStartOver = vi.fn();
    render(
      <CleanedAutographReview
        api={{ approve, preview }}
        autographId="autograph-1"
        initialPreview={initialPreview}
        onStartOver={onStartOver}
      />,
    );
    fireEvent.load(screen.getByAltText('Cleaned digital autograph preview'));
    fireEvent.click(
      screen.getByRole('button', { name: 'Approve and submit for moderation' }),
    );
    expect(
      await screen.findByRole('button', { name: 'Retry approval' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry approval' }));
    expect(await screen.findByText('Submitted for moderation')).toBeTruthy();
    expect(approve).toHaveBeenCalledTimes(2);
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh private preview' }),
    );
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    fireEvent.click(
      screen.getByRole('button', { name: 'Start a new autograph' }),
    );
    expect(onStartOver).toHaveBeenCalledTimes(1);
  });
});
