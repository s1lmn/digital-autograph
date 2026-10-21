import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  loadSecurityDocuments,
  validateSecurityDocuments,
} from './security-documents';
import { loadLegalDocuments } from './legal';

describe('separate security publication registry', () => {
  it('pins the canonical source and keeps security outside consent/Orders', () => {
    const [doc] = loadSecurityDocuments();
    expect(doc).toMatchObject({
      ready: false,
      current: true,
      version: '1.0-destka-20261010',
    });
    expect(doc!.hash).toBe(
      createHash('sha256').update(doc!.content).digest('hex'),
    );
    expect(loadLegalDocuments()).toHaveLength(14);
    expect(
      loadLegalDocuments().some((d) => String(d.type) === 'security'),
    ).toBe(false);
  });
  it('rejects tampering, traversal, duplicate identity and incomplete approval', () => {
    const doc = loadSecurityDocuments()[0]!;
    expect(() =>
      validateSecurityDocuments([doc], () => Buffer.from('changed')),
    ).toThrow();
    expect(() =>
      validateSecurityDocuments(
        [{ ...doc, file: '../internal/private.md' }],
        () => Buffer.from(doc.content),
      ),
    ).toThrow();
    expect(() =>
      validateSecurityDocuments([doc, doc], () => Buffer.from(doc.content)),
    ).toThrow();
    const content = '[[URL]]';
    expect(() =>
      validateSecurityDocuments(
        [
          {
            ...doc,
            ready: true,
            hash: createHash('sha256').update(content).digest('hex'),
          },
        ],
        () => Buffer.from(content),
      ),
    ).toThrow();
  });
});
