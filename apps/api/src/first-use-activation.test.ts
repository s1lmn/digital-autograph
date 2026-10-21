import { expect, it } from 'vitest';
import { loadLegalDocuments } from '@digital-autograph/config';
import { assertFirstUseActivation } from './first-use';
import { syntheticLegalDocuments } from '../../../tests/integration/legal-fixtures';

it('keeps real unpublished documents usable only for disabled admission, without publishing them', () => {
  const documents = loadLegalDocuments();
  expect(documents.every((d) => !d.ready)).toBe(true);
  expect(() => assertFirstUseActivation(false, documents)).not.toThrow();
  expect(() => assertFirstUseActivation(true, documents)).toThrow();
  expect(documents.every((d) => !d.ready)).toBe(true);
});
it('requires published documents without placeholders before enabling admission', () => {
  expect(() =>
    assertFirstUseActivation(true, syntheticLegalDocuments),
  ).not.toThrow();
  expect(() =>
    assertFirstUseActivation(
      true,
      syntheticLegalDocuments.map((d) => ({
        ...d,
        content: '[[UNPUBLISHED URL]]',
      })),
    ),
  ).toThrow();
});
