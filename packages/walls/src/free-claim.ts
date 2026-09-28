export type FreeClaimInput = {
  userId: string;
  wallId: string;
  slotId: string;
  autographId: string;
};

export type FreeClaimResult = {
  created: boolean;
  claimId: string;
  wallId: string;
  slotId: string;
  autographId: string;
  placement: {
    id: string;
    source: 'free_claim';
    startedAt: Date;
  };
};

export type FreeClaimErrorCode =
  | 'WALL_NOT_FOUND'
  | 'SLOT_NOT_FOUND'
  | 'SLOT_NOT_IN_WALL'
  | 'WALL_NOT_CLAIMABLE'
  | 'SLOT_OCCUPIED'
  | 'AUTOGRAPH_NOT_FOUND'
  | 'AUTOGRAPH_NOT_READY'
  | 'AUTOGRAPH_EVIDENCE_INCONSISTENT'
  | 'FREE_CLAIM_ALREADY_USED';

export class FreeClaimError extends Error {
  constructor(readonly code: FreeClaimErrorCode) {
    super(code);
  }
}

export interface FreeClaimRepository {
  claimFreeSlot(input: FreeClaimInput): Promise<FreeClaimResult>;
}

export class FreeClaimService {
  constructor(private readonly repository: FreeClaimRepository) {}

  claimFreeSlot(input: FreeClaimInput): Promise<FreeClaimResult> {
    return this.repository.claimFreeSlot(input);
  }
}
