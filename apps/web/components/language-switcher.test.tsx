// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LocaleProvider, useLocale } from './locale-provider';
import { LanguageSwitcher } from './language-switcher';
import { WallSlot } from './wall-slot';
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  cleanup();
  refresh.mockClear();
  document.cookie = 'destka-locale=; Path=/; Max-Age=0';
});
function Draft() {
  const { t } = useLocale();
  return (
    <label>
      {t('Public username (optional)')}
      <input aria-label="draft" defaultValue="My unfinished drawing" />
    </label>
  );
}
it('switches UI and accessible labels, saves the preference and keeps existing client state', () => {
  render(
    <LocaleProvider initialLocale="ru">
      <LanguageSwitcher />
      <Draft />
      <WallSlot
        slot={{
          id: 'slot',
          position: 1,
          occupied: false,
          currentPlacement: null,
        }}
        apiOrigin="https://example.test"
        actionLabel="Claim this slot"
      />
    </LocaleProvider>,
  );
  expect(screen.getByRole('button', { name: 'Занять это место' })).toBeTruthy();
  expect(screen.getByRole('listitem', { name: 'Место 2' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('draft'), {
    target: { value: 'Still editing' },
  });
  fireEvent.change(screen.getByRole('combobox', { name: 'Язык интерфейса' }), {
    target: { value: 'en' },
  });
  expect(document.documentElement.lang).toBe('en');
  expect(document.cookie).toContain('destka-locale=en');
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Claim this slot' })).toBeTruthy();
  expect(screen.getByRole('listitem', { name: 'Slot 2' })).toBeTruthy();
  expect(screen.getByLabelText('draft')).toHaveProperty(
    'value',
    'Still editing',
  );
  fireEvent.change(
    screen.getByRole('combobox', { name: 'Interface language' }),
    { target: { value: 'ru' } },
  );
  expect(document.documentElement.lang).toBe('ru');
  expect(document.cookie).toContain('destka-locale=ru');
  expect(screen.getByLabelText('draft')).toHaveProperty(
    'value',
    'Still editing',
  );
});
