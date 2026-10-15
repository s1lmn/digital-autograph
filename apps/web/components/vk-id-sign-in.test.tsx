// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { VkIdSignIn } from './vk-id-sign-in';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('VkId login visibility', () => {
  it.each([false, undefined, 'true'])(
    'stays hidden without explicit server availability (%s)',
    async (value) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ vk_id: value }),
        }),
      );
      render(
        <VkIdSignIn
          apiOrigin="http://127.0.0.1:4000"
          returnTo="/walls/example"
        />,
      );
      await waitFor(() => expect(fetch).toHaveBeenCalled());
      expect(screen.queryByRole('link')).toBeNull();
    },
  );
  it('shows the prepared Russian button and preserves the Wall return path when approved', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ vk_id: true }) }),
    );
    render(
      <VkIdSignIn
        apiOrigin="http://127.0.0.1:4000"
        returnTo="/walls/example?view=1"
      />,
    );
    const link = await screen.findByRole('link', {
      name: 'Продолжить через VK ID',
    });
    expect(link.getAttribute('href')).toBe(
      'http://127.0.0.1:4000/auth/vk-id/start?returnTo=%2Fwalls%2Fexample%3Fview%3D1',
    );
  });
  it('stays hidden on a failed availability request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<VkIdSignIn apiOrigin="http://127.0.0.1:4000" returnTo="/" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole('link')).toBeNull();
  });
});
