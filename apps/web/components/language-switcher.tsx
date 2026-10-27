'use client';

import { useRouter } from 'next/navigation';
import { useLocale } from './locale-provider';
import { Icon } from './ui-icon';
import type { Locale } from '../lib/i18n';

export function LanguageSwitcher() {
  const { locale, t, setLocale } = useLocale();
  const router = useRouter();
  return (
    <label className="languageControl">
      <Icon name="globe" size={18} />
      <select
        aria-label={t('Interface language')}
        value={locale}
        onChange={(event) => {
          setLocale(event.target.value as Locale);
          // Refresh server-rendered copy/metadata while preserving client editor state.
          router.refresh();
        }}
      >
        <option value="ru" lang="ru">
          Русский
        </option>
        <option value="en" lang="en">
          English
        </option>
      </select>
    </label>
  );
}
