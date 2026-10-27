'use client';
import { useLocale } from './locale-provider';

import { useEffect, useSyncExternalStore } from 'react';
import { Icon } from './ui-icon';

type Theme = 'system' | 'light' | 'dark';
const key = 'autograph-theme';
const eventName = 'autograph-theme-change';
let memoryTheme: Theme = 'system';

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(key);
    if (saved === 'light' || saved === 'dark' || saved === 'system')
      return saved;
    return 'system';
  } catch {
    // A blocked storage API must not prevent changing the current theme.
  }
  return memoryTheme;
}

function applyTheme(theme: Theme) {
  const dark =
    theme === 'dark' ||
    (theme === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

function subscribe(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener(eventName, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(eventName, callback);
  };
}

export function ThemeSwitcher() {
  const { t } = useLocale();

  const theme = useSyncExternalStore(subscribe, readTheme, () => 'system');
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => applyTheme(readTheme());
    update();
    media.addEventListener('change', update);
    window.addEventListener('storage', update);
    window.addEventListener(eventName, update);
    return () => {
      media.removeEventListener('change', update);
      window.removeEventListener('storage', update);
      window.removeEventListener(eventName, update);
    };
  }, []);
  return (
    <label className="themeControl">
      <Icon name="theme" size={18} />
      <select
        aria-label={t('Color theme')}
        value={theme}
        onChange={(event) => {
          const next = event.target.value as Theme;
          memoryTheme = next;
          try {
            localStorage.setItem(key, next);
          } catch {
            /* Keep the current page usable without storage. */
          }
          applyTheme(next);
          window.dispatchEvent(new Event(eventName));
        }}
      >
        <option value="system">{t('System')}</option>
        <option value="light">{t('Light')}</option>
        <option value="dark">{t('Dark')}</option>
      </select>
    </label>
  );
}
