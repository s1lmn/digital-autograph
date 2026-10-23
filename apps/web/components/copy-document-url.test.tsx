// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CopyDocumentUrl } from './copy-document-url';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('copies the immutable version URL and announces success', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  render(<CopyDocumentUrl path="/legal/terms/versions/fixture-v1" />);
  fireEvent.click(screen.getByRole('button'));
  expect(await screen.findByText('Ссылка скопирована.')).toBeTruthy();
  expect(writeText).toHaveBeenCalledWith(
    new URL('/legal/terms/versions/fixture-v1', window.location.origin).href,
  );
});
it('offers a selectable link when clipboard access fails', async () => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: undefined,
  });
  render(<CopyDocumentUrl path="/security/versions/fixture-v1" />);
  fireEvent.click(screen.getByRole('button'));
  expect(await screen.findByText(/Не удалось скопировать/)).toBeTruthy();
  expect(screen.getByRole('link').getAttribute('href')).toBe(
    '/security/versions/fixture-v1',
  );
});
