import { expect, it } from 'vitest';
import {
  isCurrentLegalState,
  requireLegalDocument,
  validateLegalAction,
  type LegalEvent,
} from './legal';
const doc = {
  type: 'terms_of_use' as const,
  version: '1',
  hash: 'a'.repeat(64),
  path: '/legal',
  ready: true,
  current: true,
};
it('requires a trusted complete document and distinguishes action semantics', () => {
  expect(requireLegalDocument([doc], doc.type)).toEqual(doc);
  expect(() =>
    requireLegalDocument([{ ...doc, hash: 'not-a-hash' }], doc.type),
  ).toThrow();
  expect(() =>
    validateLegalAction('privacy_policy', 'accepted', null),
  ).toThrow();
  expect(() => validateLegalAction('terms_of_use', 'granted', null)).toThrow();
  expect(() =>
    validateLegalAction('personal_data_consent', 'accepted', null),
  ).toThrow();
  expect(() =>
    validateLegalAction('terms_of_use', 'accepted', null),
  ).not.toThrow();
});
it('effective state requires the exact current version/hash and a nonwithdrawn event', () => {
  const event = {
    documentType: 'terms_of_use',
    documentVersion: '1',
    documentHash: doc.hash,
    action: 'accepted',
  } as LegalEvent;
  expect(isCurrentLegalState(event, doc)).toBe(true);
  expect(isCurrentLegalState(event, { ...doc, version: '2' })).toBe(false);
  expect(isCurrentLegalState({ ...event, action: 'withdrawn' }, doc)).toBe(
    false,
  );
  expect(isCurrentLegalState(event, { ...doc, ready: false })).toBe(false);
});
