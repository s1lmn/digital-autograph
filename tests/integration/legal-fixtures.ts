import { createHash } from 'node:crypto';
import type { LegalDocument } from '../../packages/domain/src/index';
// Synthetic published documents, never a claim of real legal publication/readiness.
export const syntheticLegalDocuments: (LegalDocument & { content: string })[] =
  [
    'terms_of_use',
    'community_guidelines',
    'public_offer',
    'refund_policy',
    'privacy_policy',
    'personal_data_consent',
    'personal_data_dissemination_consent',
  ].map((type) => ({
    type: type as LegalDocument['type'],
    version: 'test-v1',
    hash: createHash('sha256')
      .update(`synthetic legal fixture ${type}`)
      .digest('hex'),
    path: `/legal/documents/${type}/test-v1`,
    content: `synthetic legal fixture ${type}`,
    ready: true,
    current: true,
  }));
