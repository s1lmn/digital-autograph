import type { LegalDocument } from './legal';
export const checkoutDocumentTypes = [
  'public_offer',
  'community_guidelines',
  'refund_policy',
] as const;
export type CheckoutDocument = Pick<LegalDocument, 'version' | 'hash'> & {
  type: (typeof checkoutDocumentTypes)[number];
};
// Preconditions describe what was displayed. They never authorize financial inputs.
export type CheckoutTerms = {
  amountMinor: string;
  currency: 'RUB';
  guaranteedVisibilitySeconds: number;
  reservationExpiresAt: string;
  targetPlacementId: string;
  pricingConfigId: string;
};
export type CheckoutConfirmation = {
  confirmed: true;
  documents: CheckoutDocument[];
  terms: CheckoutTerms;
};
export type CheckoutSummary = CheckoutTerms & {
  reservationId: string;
  autographId: string;
  wallId: string;
  wallTitle: string;
  creatorName: string;
  slotId: string;
  slotNumber: number;
  documents: CheckoutDocument[];
};
