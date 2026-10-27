'use client';
import { useLocale } from '../components/locale-provider';

export default function PageError({ reset }: { reset: () => void }) {
  const { t } = useLocale();

  return (
    <main>
      <h1>{t('Page temporarily unavailable')}</h1>
      <p role="alert">{t('Check your connection and try again.')}</p>
      <button type="button" onClick={reset}>
        {t('Retry')}
      </button>
      <p>
        <a href="/">{t('Return home')}</a>
      </p>
    </main>
  );
}
