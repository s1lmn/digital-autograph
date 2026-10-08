import type { LegalDocument } from '@digital-autograph/domain';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import manifest from './legal-documents.json';
// Stable canonical UTF-8 bytes are also served by the API. Internal documents are never loaded.
export function loadLegalDocuments(): (LegalDocument & {
  content: string;
  file: string;
})[] {
  const identities = manifest.map((d) => `${d.type}:${d.version}`);
  if (
    new Set(identities).size !== identities.length ||
    manifest.some(
      (d) =>
        manifest.filter((c) => c.type === d.type && c.current).length !== 1,
    )
  )
    throw new Error('Ambiguous legal registry');
  let root = process.cwd();
  for (let i = 0; i < 4; i++, root = dirname(root)) {
    const folder = resolve(root, 'docs/legal/public');
    if (!existsSync(folder)) continue;
    return manifest.map((entry) => {
      const content = readFileSync(resolve(folder, entry.file), 'utf8');
      const hash = createHash('sha256').update(content, 'utf8').digest('hex');
      if (hash !== entry.hash || (entry.ready && content.includes('[[')))
        throw new Error('Invalid legal document registry');
      return { ...entry, type: entry.type as LegalDocument['type'], content };
    });
  }
  throw new Error('Legal document files unavailable');
}
