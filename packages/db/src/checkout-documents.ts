import { createHash } from 'node:crypto';
import {
  requireLegalDocument,
  LegalError,
  checkoutDocumentTypes,
  type LegalDocument,
} from '@digital-autograph/domain';
export function checkoutDocuments(
  documents: readonly (LegalDocument & { content?: string })[],
) {
  return checkoutDocumentTypes.map((type) => {
    const d = requireLegalDocument(documents, type);
    const content = documents.find((x) => x === d)?.content;
    if (
      typeof content !== 'string' ||
      content.includes('[[') ||
      createHash('sha256').update(content).digest('hex') !== d.hash ||
      d.path !== `/legal/documents/${d.type}/${d.version}`
    )
      throw new LegalError('LEGAL_DOCUMENT_UNAVAILABLE');
    return { type, version: d.version, hash: d.hash };
  });
}
