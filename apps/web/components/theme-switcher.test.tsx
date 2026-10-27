// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeSwitcher } from './theme-switcher';
import { themeInitScript } from '../lib/theme-init';

let dark = false;
let mediaListeners: Set<() => void>;

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  dark = false;
  mediaListeners = new Set();
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return dark;
    },
    addEventListener: (_: string, listener: () => void) =>
      mediaListeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      mediaListeners.delete(listener),
  }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setSystemDark(value: boolean) {
  dark = value;
  mediaListeners.forEach((listener) => listener());
}

describe('color theme preference', () => {
  it('applies a saved explicit preference before paint and on remount', () => {
    localStorage.setItem('autograph-theme', 'dark');
    new Function(themeInitScript)();
    expect(document.documentElement.dataset.theme).toBe('dark');
    const first = render(<ThemeSwitcher />);
    expect(
      screen.getByRole('combobox', { name: 'Color theme' }),
    ).toHaveProperty('value', 'dark');
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'light' },
    });
    expect(localStorage.getItem('autograph-theme')).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    first.unmount();
    render(<ThemeSwitcher />);
    expect(screen.getByRole('combobox')).toHaveProperty('value', 'light');
  });

  it('follows system changes only when System is selected', () => {
    render(<ThemeSwitcher />);
    expect(document.documentElement.dataset.theme).toBe('light');
    setSystemDark(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'light' },
    });
    setSystemDark(false);
    setSystemDark(true);
    expect(document.documentElement.dataset.theme).toBe('light');
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'system' },
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('synchronizes preference changes and removal from another tab', () => {
    render(<ThemeSwitcher />);
    localStorage.setItem('autograph-theme', 'dark');
    fireEvent(
      window,
      new StorageEvent('storage', { key: 'autograph-theme', newValue: 'dark' }),
    );
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('combobox')).toHaveProperty('value', 'dark');
    localStorage.removeItem('autograph-theme');
    fireEvent(
      window,
      new StorageEvent('storage', { key: 'autograph-theme', newValue: null }),
    );
    expect(screen.getByRole('combobox')).toHaveProperty('value', 'system');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('uses the system preference for invalid persisted values', () => {
    dark = true;
    localStorage.setItem('autograph-theme', 'unexpected-value');
    new Function(themeInitScript)();
    expect(document.documentElement.dataset.theme).toBe('dark');
    render(<ThemeSwitcher />);
    expect(screen.getByRole('combobox')).toHaveProperty('value', 'system');
  });

  it('keeps theme selection usable when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage blocked');
    });
    dark = true;
    new Function(themeInitScript)();
    expect(document.documentElement.dataset.theme).toBe('dark');
    render(<ThemeSwitcher />);
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'light' },
    });
    expect(screen.getByRole('combobox')).toHaveProperty('value', 'light');
    expect(document.documentElement.dataset.theme).toBe('light');
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'dark' },
    });
    expect(screen.getByRole('combobox')).toHaveProperty('value', 'dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('removes system listeners when unmounted', () => {
    const view = render(<ThemeSwitcher />);
    expect(mediaListeners.size).toBe(1);
    view.unmount();
    expect(mediaListeners.size).toBe(0);
  });
});
