import { getTranslator } from '../../lib/i18n-server';
export default async function LegalNotFound() {
  const t = await getTranslator();

  return (
    <main>
      <p className="eyebrow">{t('Destka')}</p>
      <h1>{t('Документ не найден')}</h1>
      <p>{t('Эта редакция недоступна или ещё не опубликована.')}</p>
      <a href="/legal">{t('Каталог опубликованных документов')}</a>
    </main>
  );
}
