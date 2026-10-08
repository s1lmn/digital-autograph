// @vitest-environment jsdom
import { it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShareControls } from './share-controls';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
import { cleanup } from '@testing-library/react';
it('requires separate username publication consent and provides a copy fallback', async () => {
  const request = vi.fn(
    async () => new Response(JSON.stringify({ id: 'public-share' })),
  );
  vi.stubGlobal('fetch', request);
  const copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: copy },
    configurable: true,
  });
  Object.defineProperty(navigator, 'share', {
    value: undefined,
    configurable: true,
  });
  render(
    <ShareControls
      apiOrigin="https://api.test"
      wallId="wall"
      slots={[{ id: 'slot', position: 0 }]}
    />,
  );
  fireEvent.change(screen.getByLabelText('Your slot'), {
    target: { value: 'slot' },
  });
  fireEvent.change(screen.getByLabelText('Public username (optional)'), {
    target: { value: 'Fan' },
  });
  expect(
    (
      screen.getByRole('button', {
        name: 'Create share card',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(
    screen.getByLabelText('Publish this username on a public card'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Create share card' }));
  await screen.findByText('Open share card');
  fireEvent.click(screen.getByRole('button', { name: 'Share or copy link' }));
  await screen.findByText('Link copied.');
  expect(copy).toHaveBeenCalledWith(expect.stringContaining('/s/public-share'));
  expect(request.mock.calls.length).toBe(2);
});
