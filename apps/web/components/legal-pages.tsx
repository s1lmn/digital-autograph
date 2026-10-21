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
export function DocumentLinks({ documents }: { documents: Publication[] }) {
  return (
    <nav className={styles.navigation} aria-label="Другие документы">
      <h2>Документы Destka</h2>
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
                {route.title}
                {versions.some((d) => d.current) ? '' : ' — архив редакций'}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
export function UnavailableDocument() {
  return (
    <main lang="ru" className={styles.page}>
      <p className="eyebrow">Destka</p>
      <h1>Документы временно недоступны</h1>
      <p role="alert">
        Не удалось загрузить опубликованные документы. Попробуйте обновить
        страницу позже.
      </p>
      <a href="/legal">Каталог документов</a>
    </main>
  );
}
export async function LegalIndex() {
  try {
    const documents = await loadPublications();
    return (
      <main lang="ru" className={styles.page}>
        <p className="eyebrow">Destka</p>
        <h1>Юридические документы</h1>
        {!documents.length && <p>Опубликованных документов пока нет.</p>}
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
  try {
    const documents = await loadPublications();
    const doc = selectPublication(documents, type, version);
    const text = await getPublicationText(
      loadWebConfig().API_INTERNAL_URL,
      doc,
    );
    return (
      <main lang="ru" className={styles.page}>
        <p className="eyebrow">Destka</p>
        <h1>{documentRoutes.find((d) => d.type === type)!.title}</h1>
        <p className={styles.meta}>
          Редакция {doc.version}
          {doc.current ? ' · Текущая редакция' : ' · Архивная редакция'}
        </p>
        <CopyDocumentUrl path={versionPath(doc)} />
        <section aria-label="Текст документа" className={styles.text}>
          {text}
        </section>
        <p>
          <a className="actionLink" href={`${documentBase(type)}/archive`}>
            Архив редакций
          </a>
        </p>
        <a href="/legal">Все документы</a>
        <DocumentLinks documents={documents} />
      </main>
    );
  } catch (error) {
    if (error instanceof PublicationError && error.status === 404) notFound();
    return <UnavailableDocument />;
  }
}
export async function DocumentArchive({ type }: { type: DocumentType }) {
  try {
    const documents = await loadPublications();
    const versions = documents.filter((d) => d.type === type);
    if (!versions.length) throw new PublicationError(404);
    return (
      <main lang="ru" className={styles.page}>
        <p className="eyebrow">Destka</p>
        <h1>Архив редакций</h1>
        <h2>{documentRoutes.find((d) => d.type === type)!.title}</h2>
        <ul className="contentList">
          {versions.map((d) => (
            <li key={d.version}>
              <a className="actionLink" href={versionPath(d)}>
                Редакция {d.version}
              </a>
              {d.current && <p>Текущая редакция</p>}
            </li>
          ))}
        </ul>
        <a href="/legal">Все документы</a>
        <DocumentLinks documents={documents} />
      </main>
    );
  } catch (error) {
    if (error instanceof PublicationError && error.status === 404) notFound();
    return <UnavailableDocument />;
  }
}
