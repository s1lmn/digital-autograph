'use client';
import { useLocale } from './locale-provider';

import { useState } from 'react';

export function CopyDocumentUrl({ path }: { path: string }) {
  const { t } = useLocale();

  const [status, setStatus] = useState('');
  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(
              new URL(path, window.location.origin).href,
            );
            setStatus('Ссылка скопирована.');
          } catch {
            setStatus('Не удалось скопировать. Скопируйте адрес ссылки ниже.');
          }
        }}
      >
        {t('Копировать ссылку на редакцию')}
      </button>
      <p aria-live="polite">{t(status)}</p>
      <a href={path}>{t('Постоянная ссылка на эту редакцию')}</a>
    </div>
  );
}
