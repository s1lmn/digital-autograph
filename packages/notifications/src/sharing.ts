export type PublicShare = {
  id: string;
  wallId: string;
  slotId: string | null;
  slotNumber: number | null;
  creator: string;
  publicAlias: string | null;
  event: 'slot_claimed' | 'takeover' | 'final_wall';
};
export interface ShareRepository {
  create(
    userId: string,
    input: { wallId: string; slotId?: string; publicAlias?: string },
  ): Promise<PublicShare>;
  public(id: string): Promise<PublicShare | null>;
  revoke(userId: string, id: string): Promise<void>;
  interact(
    id: string,
    kind: 'share_clicked' | 'referral_arrived',
    dedupeKey: string,
  ): Promise<void>;
}
