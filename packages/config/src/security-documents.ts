import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import manifest from './security-documents.json';

// Separate from LegalDocumentType, consent evidence and Order snapshots.
export type SecurityDocument = {
  version: string;
  hash: string;
  file: string;
  current: boolean;
  ready: boolean;
  content: string;
};
export function validateSecurityDocuments(
  entries: readonly Omit<SecurityDocument, 'content'>[],
  readFile: (file: string) => Buffer,
): SecurityDocument[] {
  if (
    entries.filter((d) => d.current).length !== 1 ||
    new Set(entries.map((d) => d.version)).size !== entries.length ||
    entries.some(
      (d) =>
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(d.version) ||
        !/^[a-z0-9-]+\.md$/.test(d.file),
    )
  )
    throw new Error('Ambiguous security document registry');
  return entries.map((entry) => {
    const bytes = readFile(entry.file);
    const content = bytes.toString('utf8');
    if (
      !Buffer.from(content).equals(bytes) ||
      createHash('sha256').update(bytes).digest('hex') !== entry.hash ||
      (entry.ready && content.includes('[['))
    ) {
      throw new Error('Invalid security document registry');
    }
    return { ...entry, content };
  });
}
export function loadSecurityDocuments(): SecurityDocument[] {
  let root = process.cwd();
  for (let i = 0; i < 4; i++, root = dirname(root)) {
    const folder = resolve(root, 'docs/legal/security');
    if (!existsSync(folder)) continue;
    return validateSecurityDocuments(manifest, (file) =>
      readFileSync(resolve(folder, file)),
    );
  }
  throw new Error('Security document files unavailable');
}
