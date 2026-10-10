import {
  legalDocumentTypes,
  type LegalDocument,
} from '@digital-autograph/domain';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import manifest from './legal-documents.json';
type RegistryEntry = LegalDocument & { file: string };

export function validateLegalDocuments(
  entries: readonly RegistryEntry[],
  readPublicFile: (file: string) => Buffer,
) {
  const identities = entries.map((d) => `${d.type}:${d.version}`);
  if (
    new Set(identities).size !== identities.length ||
    legalDocumentTypes.some(
      (type) =>
        entries.filter((d) => d.type === type && d.current).length !== 1,
    ) ||
    entries.some(
      (d) =>
        !legalDocumentTypes.includes(d.type) ||
        !/^[a-zA-Z0-9._-]{1,64}$/.test(d.version) ||
        !/^[a-z0-9-]+\.md$/.test(d.file) ||
        d.path !== `/legal/documents/${d.type}/${d.version}`,
    )
  )
    throw new Error('Ambiguous legal registry');
  return entries.map((entry) => {
    const bytes = readPublicFile(entry.file);
    const content = bytes.toString('utf8');
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (
      !Buffer.from(content, 'utf8').equals(bytes) ||
      hash !== entry.hash ||
      (entry.ready && content.includes('[['))
    )
      throw new Error('Invalid legal document registry');
    return { ...entry, content };
  });
}
// Stable canonical UTF-8 bytes are also served by the API. Internal documents are never loaded.
export function loadLegalDocuments(): (LegalDocument & {
  content: string;
  file: string;
})[] {
  let root = process.cwd();
  for (let i = 0; i < 4; i++, root = dirname(root)) {
    const folder = resolve(root, 'docs/legal/public');
    if (!existsSync(folder)) continue;
    return validateLegalDocuments(manifest as RegistryEntry[], (file) =>
      readFileSync(resolve(folder, file)),
    );
  }
  throw new Error('Legal document files unavailable');
}
