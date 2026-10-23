// Contractual acceptance is distinct from optional, revocable consent.
export const legalDocumentTypes = [
  'terms_of_use',
  'community_guidelines',
  'public_offer',
  'refund_policy',
  'privacy_policy',
  'personal_data_consent',
  'personal_data_dissemination_consent',
] as const;
export type LegalDocumentType = (typeof legalDocumentTypes)[number];
export type LegalAction = 'accepted' | 'granted' | 'withdrawn';
export type LegalDocument = {
  type: LegalDocumentType;
  version: string;
  hash: string;
  path: string;
  ready: boolean;
  current: boolean;
};
export type LegalScope = {
  purpose: string;
  dataItems: string[];
  resourceUrls: string[];
  conditions: string[];
};
export type LegalEvent = {
  id: string;
  userId: string;
  documentType: LegalDocumentType;
  documentVersion: string;
  documentHash: string;
  action: LegalAction;
  source: string;
  context: string;
  scope: LegalScope | null;
  previousEventId: string | null;
  occurredAt: Date;
};
export class LegalError extends Error {
  constructor(
    public readonly code:
      | 'LEGAL_DOCUMENT_UNAVAILABLE'
      | 'INVALID_LEGAL_ACTION'
      | 'LEGAL_USER_UNAVAILABLE',
  ) {
    super(code);
  }
}
export function requireLegalDocument(
  documents: readonly LegalDocument[],
  type: LegalDocumentType,
): LegalDocument {
  const matches = documents.filter((d) => d.type === type && d.current);
  const document = matches.length === 1 ? matches[0] : undefined;
  if (
    !document?.ready ||
    !/^[a-f0-9]{64}$/.test(document.hash) ||
    !/^[a-zA-Z0-9._-]{1,64}$/.test(document.version)
  )
    throw new LegalError('LEGAL_DOCUMENT_UNAVAILABLE');
  return document;
}
export function validateLegalAction(
  type: LegalDocumentType,
  action: LegalAction,
  scope: LegalScope | null,
) {
  const consent =
    type === 'personal_data_consent' ||
    type === 'personal_data_dissemination_consent';
  if (
    !legalDocumentTypes.includes(type) ||
    type === 'privacy_policy' ||
    (consent
      ? action === 'accepted' || !scope
      : action !== 'accepted' || scope !== null)
  )
    throw new LegalError('INVALID_LEGAL_ACTION');
  if (
    scope &&
    (!/^[a-z][a-z0-9_]{0,63}$/.test(scope.purpose) ||
      !scope.dataItems.length ||
      scope.dataItems.length > 16 ||
      scope.dataItems.some((x) => !/^[a-z][a-z0-9_]{0,63}$/.test(x)) ||
      scope.resourceUrls.length > 16 ||
      scope.conditions.length > 16 ||
      scope.conditions.some((x) => x.length > 512))
  )
    throw new LegalError('INVALID_LEGAL_ACTION');
  // Dissemination requires a complete subject-identity/restrictions publication flow.
  // This foundation deliberately cannot grant public dissemination permission.
  if (type === 'personal_data_dissemination_consent' && action === 'granted')
    throw new LegalError('INVALID_LEGAL_ACTION');
}
export function isCurrentLegalState(
  event: LegalEvent | null,
  document: LegalDocument,
): boolean {
  return (
    !!document.ready &&
    document.current &&
    !!event &&
    event.documentType === document.type &&
    event.action !== 'withdrawn' &&
    event.documentVersion === document.version &&
    event.documentHash === document.hash
  );
}
export interface LegalRepository {
  latest(
    userId: string,
    type: LegalDocumentType,
    purpose?: string,
  ): Promise<LegalEvent | null>;
  record(
    userId: string,
    document: LegalDocument,
    action: LegalAction,
    source: string,
    context: string,
    scope?: LegalScope,
  ): Promise<LegalEvent | null>;
}
