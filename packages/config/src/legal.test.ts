import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { loadLegalDocuments, validateLegalDocuments } from './legal';
import { requireLegalDocument } from '../../domain/src/legal';
describe('canonical legal registry', () => {
  it('hashes exact served public bytes and fails closed on incomplete legal documents', () => {
    const docs = loadLegalDocuments();
    expect(docs).toHaveLength(14);
    expect(docs.filter((d) => d.current)).toHaveLength(7);
    for (const d of docs) {
      expect(createHash('sha256').update(d.content).digest('hex')).toBe(d.hash);

      expect(d.ready).toBe(false);
      expect(() => requireLegalDocument(docs, d.type)).toThrow(
        'LEGAL_DOCUMENT_UNAVAILABLE',
      );
    }
  });
});
it('preserves all nine historical source wordings and original section/list numbering', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const records = JSON.parse(
    readFileSync(resolve('docs/legal/source-integrity.json'), 'utf8'),
  ) as { file: string; wordingSha256: string }[];
  expect(records).toHaveLength(9);
  for (const r of records) {
    const text = readFileSync(resolve('docs/legal', r.file), 'utf8')
      .trim()
      .split(/\s+/)
      .join(' ');
    expect(createHash('sha256').update(text).digest('hex')).toBe(
      r.wordingSha256,
    );
  }
});

it('verifies the eight pinned DOCX hashes and exact canonical bytes independently of old identities', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const records = JSON.parse(
    readFileSync('docs/legal/destka-source-integrity.json', 'utf8'),
  ) as {
    file: string;
    sourceFile: string;
    sourceDocxSha256: string;
    contentSha256: string;
    placeholderOccurrences: number;
    substantiveDifferences: string[];
  }[];
  expect(records).toHaveLength(8);
  for (const record of records) {
    const bytes = readFileSync(resolve('docs/legal', record.file));
    const original = readFileSync(
      resolve(
        'docs/legal/sources/destka-20261010/original_docx',
        record.sourceFile,
      ),
    );
    expect(createHash('sha256').update(original).digest('hex')).toBe(
      record.sourceDocxSha256,
    );
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      record.contentSha256,
    );
    expect(bytes.toString()).not.toContain('Digital Autograph');
    expect(record.substantiveDifferences).toEqual([]);
    expect(bytes.toString().match(/\[\[.*?\]\]/g)?.length ?? 0).toBe(
      record.placeholderOccurrences,
    );
  }
  expect(records.reduce((sum, r) => sum + r.placeholderOccurrences, 0)).toBe(
    16,
  );
  const docs = loadLegalDocuments();
  expect(
    docs
      .filter((d) => d.current)
      .every((d) => d.version === '1.0-destka-20261010'),
  ).toBe(true);
  expect(docs.filter((d) => !d.current).every((d) => d.version === '1.0')).toBe(
    true,
  );
  expect(docs.some((d) => d.file.includes('vulnerability'))).toBe(false);
});

it('rejects ambiguous/missing types, internal paths, byte tampering and ready placeholders', () => {
  const docs = loadLegalDocuments();
  const read = (file: string) =>
    Buffer.from(docs.find((d) => d.file === file)!.content);
  const current = docs.filter((d) => d.current);
  for (const entries of [
    [...docs, docs[0]!],
    docs.filter((d) => d.type !== 'public_offer'),
    docs.map((d) => ({ ...d, current: true })),
    current.map((d) => ({ ...d, file: '../internal/consent-ux-spec-v1.md' })),
  ])
    expect(() => validateLegalDocuments(entries, read)).toThrow(
      'Ambiguous legal registry',
    );
  expect(() =>
    validateLegalDocuments(docs, () => Buffer.from('tampered')),
  ).toThrow('Invalid legal document registry');
  expect(() =>
    validateLegalDocuments(
      docs.map((d) => ({ ...d, ready: true })),
      read,
    ),
  ).toThrow('Invalid legal document registry');
});
