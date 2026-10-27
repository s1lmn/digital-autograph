import { getTranslator } from '../lib/i18n-server';
export default async function NotFound() {
  const t = await getTranslator();

  return (
    <main>
      <h1>{t('Page not found')}</h1>
      <p>
        {t('This page may no longer be public, or the link may be incorrect.')}
      </p>
      <a href="/">{t('Return home')}</a>
    </main>
  );
}
