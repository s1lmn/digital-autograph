import { getTranslator } from '../lib/i18n-server';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { loadWebConfig } from '@digital-autograph/config';
import {
  documentRoutes,
  documentBase,
  versionPath,
  getPublications,
  selectPublication,
  getPublicationText,
  PublicationError,
  type DocumentType,
  type Publication,
} from '../lib/legal-publications';
import { CopyDocumentUrl } from './copy-document-url';
import styles from './legal-pages.module.css';

export const loadPublications = cache(() =>
  getPublications(loadWebConfig().API_INTERNAL_URL),
);
export async function DocumentLinks({
  documents,
}: {
  documents: Publication[];
}) {
  const t = await getTranslator();

  return (
    <nav className={styles.navigation} aria-label={t('Другие документы')}>
      <h2>{t('Документы Destka')}</h2>
      <ul>
        {documentRoutes.map((route) => {
          const versions = documents.filter((d) => d.type === route.type);
          if (!versions.length) return null;
          return (
            <li key={route.type}>
              <a
                href={
                  versions.some((d) => d.current)
                    ? documentBase(route.type)
                    : `${documentBase(route.type)}/archive`
                }
              >
                {t(route.title)}
                {versions.some((d) => d.current) ? '' : t(' — архив редакций')}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
export async function UnavailableDocument() {
  const t = await getTranslator();

  return (
    <main className={styles.page}>
      <p className="eyebrow">{t('Destka')}</p>
      <h1>{t('Документы временно недоступны')}</h1>
      <p role="alert">
        {t(
          'Не удалось загрузить опубликованные документы. Попробуйте обновить страницу позже.',
        )}
      </p>
      <a href="/legal">{t('Каталог документов')}</a>
    </main>
  );
}
export async function LegalIndex() {
  const t = await getTranslator();

  try {
    const documents = await loadPublications();
    return (
      <main className={styles.page}>
        <p className="eyebrow">{t('Destka')}</p>
        <h1>{t('Юридические документы')}</h1>
        {!documents.length && <p>{t('Опубликованных документов пока нет.')}</p>}
        <DocumentLinks documents={documents} />
      </main>
    );
  } catch {
    return <UnavailableDocument />;
  }
}
export async function DocumentPage({
  type,
  version,
}: {
  type: DocumentType;
  version?: string;
}) {
  const t = await getTranslator();

  try {
    const documents = await loadPublications();
    const doc = selectPublication(documents, type, version);
    const text = await getPublicationText(
      loadWebConfig().API_INTERNAL_URL,
      doc,
    );
    return (
      <main className={styles.page}>
        <p className="eyebrow">{t('Destka')}</p>
        <h1>{t(documentRoutes.find((d) => d.type === type)!.title)}</h1>
        <p className={styles.meta}>
          {t('Редакция ')}
          {doc.version}
          {doc.current ? t(' · Текущая редакция') : t(' · Архивная редакция')}
        </p>
        <CopyDocumentUrl path={versionPath(doc)} />
        <p className={styles.meta}>
          {t(
            'Published documents are provided in their original Russian. Changing the interface language does not translate the legal text.',
          )}
        </p>
        <section
          lang="ru"
          aria-label={t('Текст документа')}
          className={styles.text}
        >
          {text}
        </section>
        <p>
          <a className="actionLink" href={`${documentBase(type)}/archive`}>
            {t('Архив редакций')}
          </a>
        </p>
        <a href="/legal">{t('Все документы')}</a>
        <DocumentLinks documents={documents} />
      </main>
    );
  } catch (error) {
    if (error instanceof PublicationError && error.status === 404) notFound();
    return <UnavailableDocument />;
  }
}
export async function DocumentArchive({ type }: { type: DocumentType }) {
  const t = await getTranslator();

  try {
    const documents = await loadPublications();
    const versions = documents.filter((d) => d.type === type);
    if (!versions.length) throw new PublicationError(404);
    return (
      <main className={styles.page}>
        <p className="eyebrow">{t('Destka')}</p>
        <h1>{t('Архив редакций')}</h1>
        <h2>{t(documentRoutes.find((d) => d.type === type)!.title)}</h2>
        <ul className="contentList">
          {versions.map((d) => (
            <li key={d.version}>
              <a className="actionLink" href={versionPath(d)}>
                {t('Редакция ')}
                {d.version}
              </a>
              {d.current && <p>{t('Текущая редакция')}</p>}
            </li>
          ))}
        </ul>
        <a href="/legal">{t('Все документы')}</a>
        <DocumentLinks documents={documents} />
      </main>
    );
  } catch (error) {
    if (error instanceof PublicationError && error.status === 404) notFound();
    return <UnavailableDocument />;
  }
}
