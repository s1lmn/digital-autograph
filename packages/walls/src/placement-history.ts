export type PlacementSource = 'free_claim' | 'takeover' | 'admin';
export type SafePlacementEndReason =
  'displaced' | 'wall_ended' | 'administrative' | 'other';

export type PlacementHistoryRecord = {
  wallId: string;
  wallSlug: string;
  wallDisplayName: string;
  wallIsPublic: boolean;
  slotPosition: number;
  source: PlacementSource;
  startedAt: Date;
  endedAt: Date | null;
  endReason: SafePlacementEndReason | null;
};

export type PlacementHistoryRow = Omit<PlacementHistoryRecord, 'endReason'> & {
  endReason: string | null;
};

export type PublicWallPlacementHistory = {
  wallId: string;
  placements: Array<
    Pick<
      PlacementHistoryRecord,
      'slotPosition' | 'source' | 'startedAt' | 'endedAt' | 'endReason'
    >
  >;
};

export interface PlacementHistoryRepository {
  listPublicWallHistory(wallId: string): Promise<PlacementHistoryRow[] | null>;
  listUserHistory(userId: string): Promise<PlacementHistoryRow[]>;
}

export class PlacementHistoryService {
  constructor(private readonly repository: PlacementHistoryRepository) {}

  async getPublicWallHistory(
    wallId: string,
  ): Promise<PublicWallPlacementHistory | null> {
    const records = await this.repository.listPublicWallHistory(wallId);
    if (records === null) return null;
    return {
      wallId,
      placements: records.map(
        ({ slotPosition, source, startedAt, endedAt, endReason }) => ({
          slotPosition,
          source,
          startedAt,
          endedAt,
          endReason: safeEndReason(endReason),
        }),
      ),
    };
  }

  async getUserHistory(userId: string): Promise<PlacementHistoryRecord[]> {
    const records = await this.repository.listUserHistory(userId);
    return records.map((record) => ({
      ...record,
      endReason: safeEndReason(record.endReason),
    }));
  }
}

function safeEndReason(reason: string | null): SafePlacementEndReason | null {
  if (reason === null) return null;
  switch (reason) {
    case 'takeover':
    case 'displaced':
    case 'displaced_by_takeover':
      return 'displaced';
    case 'wall_ended':
      return 'wall_ended';
    case 'administrative':
    case 'admin':
      return 'administrative';
    default:
      return 'other';
  }
}
