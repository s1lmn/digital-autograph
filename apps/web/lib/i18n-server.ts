import { cookies } from 'next/headers';
import {
  localeCookie,
  parseLocale,
  translate,
  type TranslationValues,
} from './i18n';

export async function getLocale() {
  return parseLocale((await cookies()).get(localeCookie)?.value);
}
export async function getTranslator() {
  const locale = await getLocale();
  return (text: string, values?: TranslationValues) =>
    translate(text, locale, values);
}

export async function localizeMetadata(
  metadata: import('next').Metadata,
): Promise<import('next').Metadata> {
  const t = await getTranslator();
  const title = metadata.title;
  return {
    ...metadata,
    openGraph: metadata.openGraph
      ? {
          ...metadata.openGraph,
          description: metadata.openGraph.description
            ? t(metadata.openGraph.description)
            : undefined,
        }
      : metadata.openGraph,
    title:
      typeof title === 'string'
        ? t(title)
        : title && typeof title === 'object'
          ? 'default' in title
            ? { ...title, default: t(title.default) }
            : 'absolute' in title
              ? { ...title, absolute: t(title.absolute) }
              : title
          : title,
    description:
      typeof metadata.description === 'string'
        ? t(metadata.description)
        : metadata.description,
  };
}
