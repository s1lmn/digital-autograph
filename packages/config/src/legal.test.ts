import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { loadLegalDocuments } from './legal';
import { requireLegalDocument } from '../../domain/src/legal';
describe('canonical legal registry', () => {
  it('hashes exact served public bytes and fails closed on incomplete legal documents', () => {
    const docs = loadLegalDocuments();
    expect(docs).toHaveLength(7);
    for (const d of docs) {
      expect(createHash('sha256').update(d.content).digest('hex')).toBe(d.hash);
      expect(d.content).toContain('[[');
      expect(d.ready).toBe(false);
      expect(() => requireLegalDocument(docs, d.type)).toThrow(
        'LEGAL_DOCUMENT_UNAVAILABLE',
      );
    }
  });
});
it('preserves all nine approved source wordings and original section/list numbering', async () => {
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
