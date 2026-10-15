import { createHash } from 'node:crypto';

export const documentRoutes = [
  { type: 'terms_of_use', slug: 'terms', title: 'Пользовательское соглашение' },
  {
    type: 'community_guidelines',
    slug: 'content-rules',
    title: 'Правила размещения контента',
  },
  { type: 'public_offer', slug: 'offer', title: 'Публичная оферта' },
  { type: 'refund_policy', slug: 'refunds', title: 'Политика возвратов' },
  {
    type: 'privacy_policy',
    slug: 'privacy',
    title: 'Политика обработки персональных данных',
  },
  {
    type: 'personal_data_consent',
    slug: 'personal-data-consent',
    title: 'Согласие на обработку персональных данных',
  },
  {
    type: 'personal_data_dissemination_consent',
    slug: 'dissemination-consent',
    title: 'Согласие на распространение персональных данных',
  },
  {
    type: 'security',
    slug: 'security',
    title: 'Политика сообщения об уязвимостях',
  },
] as const;
export type DocumentType = (typeof documentRoutes)[number]['type'];
export type Publication = {
  type: DocumentType;
  version: string;
  hash: string;
  current: boolean;
  path: string;
};
export class PublicationError extends Error {
  constructor(public readonly status: number) {
    super('Public document unavailable');
  }
}
export const documentBase = (type: DocumentType) =>
  type === 'security'
    ? '/security'
    : `/legal/${documentRoutes.find((d) => d.type === type)!.slug}`;
export const versionPath = (d: Publication) =>
  `${documentBase(d.type)}/versions/${d.version}`;
export const apiDocumentPath = (type: DocumentType, version: string) =>
  type === 'security'
    ? `/security/documents/${version}`
    : `/legal/documents/${type}/${version}`;
const validVersion = (version: string) =>
  /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(version);
async function request(origin: string, path: string) {
  try {
    const response = await fetch(`${origin}${path}`, {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new PublicationError(response.status);
    return response;
  } catch (error) {
    if (error instanceof PublicationError) throw error;
    throw new PublicationError(503);
  }
}
// SSR reads only the API's published projection; never import a source registry/text.
export async function getPublications(origin: string): Promise<Publication[]> {
  try {
    const lists = await Promise.all(
      ['/legal/documents', '/security/documents'].map(async (path) => {
        const value: unknown = await (await request(origin, path)).json();
        if (
          !value ||
          typeof value !== 'object' ||
          !('documents' in value) ||
          !Array.isArray(value.documents)
        )
          throw new PublicationError(503);
        return value.documents.map((d: unknown) => {
          if (
            !d ||
            typeof d !== 'object' ||
            !('type' in d) ||
            !('version' in d) ||
            !('hash' in d) ||
            !('current' in d) ||
            !('path' in d) ||
            !documentRoutes.some((route) => route.type === d.type) ||
            typeof d.version !== 'string' ||
            !validVersion(d.version) ||
            typeof d.hash !== 'string' ||
            !/^[a-f0-9]{64}$/.test(d.hash) ||
            typeof d.current !== 'boolean' ||
            (d.type === 'security') !== (path === '/security/documents') ||
            d.path !== apiDocumentPath(d.type as DocumentType, d.version)
          )
            throw new PublicationError(503);
          return {
            type: d.type as DocumentType,
            version: d.version,
            hash: d.hash,
            current: d.current,
            path: d.path as string,
          };
        });
      }),
    );
    const documents = lists.flat();
    if (
      new Set(documents.map((d) => `${d.type}:${d.version}`)).size !==
        documents.length ||
      documentRoutes.some(
        (route) =>
          documents.filter((d) => d.type === route.type && d.current).length >
          1,
      )
    )
      throw new PublicationError(503);
    return documents;
  } catch {
    throw new PublicationError(503);
  }
}
export function selectPublication(
  documents: Publication[],
  type: DocumentType,
  version?: string,
) {
  if (version !== undefined && !validVersion(version))
    throw new PublicationError(404);
  const doc = documents.find(
    (d) =>
      d.type === type &&
      (version === undefined ? d.current : d.version === version),
  );
  if (!doc) throw new PublicationError(404);
  return doc;
}
export async function getPublicationText(origin: string, doc: Publication) {
  const response = await request(origin, doc.path);
  if (
    response.headers.get('x-legal-document-status') !== 'published' ||
    !response.headers.get('content-type')?.startsWith('text/plain')
  )
    throw new PublicationError(503);
  const bytes = Buffer.from(await response.arrayBuffer());
  const text = bytes.toString('utf8');
  if (
    !Buffer.from(text).equals(bytes) ||
    text.includes('[[') ||
    createHash('sha256').update(bytes).digest('hex') !== doc.hash
  )
    throw new PublicationError(503);
  return text;
}
