import { getTranslator } from '../lib/i18n-server';
export default async function Loading() {
  const t = await getTranslator();

  return (
    <main>
      <p role="status">{t('Loading page…')}</p>
    </main>
  );
}
