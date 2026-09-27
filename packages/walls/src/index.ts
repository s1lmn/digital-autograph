import {
  WallRuleError,
  transitionWall,
  validateScheduledConfiguration,
  validateWallConfiguration,
  type WallAction,
  type WallStatus,
} from '@digital-autograph/domain';

export type SlotStructure = { id: string; position: number };

export type WallSnapshot = {
  id: string;
  creatorId: string;
  status: WallStatus;
  slotCount: number;
  startAt: Date | null;
  endAt: Date | null;
  slots: SlotStructure[];
  hasHistory: boolean;
};

export type WallMutation = {
  status?: WallStatus;
  slotCount?: number;
  startAt?: Date | null;
  endAt?: Date | null;
};

export type PublicCreator = {
  id: string;
  slug: string;
  displayName: string;
  walls: Array<{
    id: string;
    status: WallStatus;
    startAt: Date | null;
    endAt: Date | null;
  }>;
};

export type PublicWall = {
  id: string;
  status: WallStatus;
  startAt: Date | null;
  endAt: Date | null;
  slotCount: number;
  creator: { id: string; slug: string; displayName: string };
  slots: Array<{
    id: string;
    position: number;
    occupied: boolean;
    currentPlacement: {
      id: string;
      source: 'free_claim' | 'takeover' | 'admin';
      startedAt: Date;
    } | null;
  }>;
};

export type WallErrorCode =
  | 'CREATOR_NOT_FOUND'
  | 'WALL_NOT_FOUND'
  | 'FORBIDDEN'
  | 'INVALID_WALL_TRANSITION'
  | 'WALL_STRUCTURE_LOCKED'
  | 'INVALID_WALL_CONFIGURATION';

export class WallError extends Error {
  constructor(readonly code: WallErrorCode) {
    super(code);
  }
}

export interface WallRepository {
  findCreatorOwner(creatorId: string): Promise<string | null | undefined>;
  findPublicCreator(slug: string): Promise<PublicCreator | null>;
  findPublicWall(wallId: string): Promise<PublicWall | null>;
  createOwnedWall(
    actorUserId: string,
    creatorId: string,
    input: { slotCount: number; startAt: Date | null; endAt: Date | null },
  ): Promise<WallSnapshot>;
  mutateOwnedWall(
    actorUserId: string,
    wallId: string,
    decide: (current: WallSnapshot) => WallMutation,
  ): Promise<WallSnapshot>;
}

function validateConfig(config: { startAt: Date | null; endAt: Date | null }) {
  try {
    validateWallConfiguration(config);
  } catch (error) {
    if (error instanceof WallRuleError) throw new WallError(error.code);
    throw error;
  }
}

function validSlotCount(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 1000;
}

export class WallService {
  constructor(
    private readonly repository: WallRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async requireCreatorOwner(
    actorUserId: string,
    creatorId: string,
  ): Promise<void> {
    const ownerUserId = await this.repository.findCreatorOwner(creatorId);
    if (ownerUserId === undefined) throw new WallError('CREATOR_NOT_FOUND');
    if (ownerUserId !== actorUserId) throw new WallError('FORBIDDEN');
  }

  async getCreator(slug: string): Promise<PublicCreator> {
    const creator = await this.repository.findPublicCreator(slug);
    if (!creator) throw new WallError('CREATOR_NOT_FOUND');
    return creator;
  }

  async getWall(wallId: string): Promise<PublicWall> {
    const wall = await this.repository.findPublicWall(wallId);
    if (!wall) throw new WallError('WALL_NOT_FOUND');
    return wall;
  }

  async createWall(
    actorUserId: string,
    creatorId: string,
    input: { slotCount: number; startAt: Date | null; endAt: Date | null },
  ): Promise<WallSnapshot> {
    if (!validSlotCount(input.slotCount)) {
      throw new WallError('INVALID_WALL_CONFIGURATION');
    }
    validateConfig(input);
    return this.repository.createOwnedWall(actorUserId, creatorId, input);
  }

  async updateWall(
    actorUserId: string,
    wallId: string,
    patch: {
      slotCount?: number;
      startAt?: Date | null;
      endAt?: Date | null;
    },
  ): Promise<WallSnapshot> {
    return this.repository.mutateOwnedWall(actorUserId, wallId, (current) => {
      const slotCount = patch.slotCount ?? current.slotCount;
      if (!validSlotCount(slotCount)) {
        throw new WallError('INVALID_WALL_CONFIGURATION');
      }
      if (
        slotCount !== current.slotCount &&
        (current.status !== 'draft' || current.hasHistory)
      ) {
        throw new WallError('WALL_STRUCTURE_LOCKED');
      }
      if (current.status !== 'draft' && current.status !== 'scheduled') {
        throw new WallError('INVALID_WALL_TRANSITION');
      }
      const config = {
        startAt: patch.startAt === undefined ? current.startAt : patch.startAt,
        endAt: patch.endAt === undefined ? current.endAt : patch.endAt,
      };
      try {
        if (current.status === 'scheduled') {
          validateScheduledConfiguration(config, this.clock());
        } else {
          validateWallConfiguration(config);
        }
      } catch (error) {
        if (error instanceof WallRuleError) throw new WallError(error.code);
        throw error;
      }
      return { ...config, slotCount };
    });
  }

  async transitionWall(
    actorUserId: string,
    wallId: string,
    action: WallAction,
  ): Promise<WallSnapshot> {
    return this.repository.mutateOwnedWall(actorUserId, wallId, (current) => {
      try {
        return {
          status: transitionWall(current.status, action, current, this.clock()),
        };
      } catch (error) {
        if (error instanceof WallRuleError) throw new WallError(error.code);
        throw error;
      }
    });
  }
}
