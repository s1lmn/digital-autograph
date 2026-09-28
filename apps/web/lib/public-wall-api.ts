export type PublicWall = {
  id: string;
  status: 'scheduled' | 'live' | 'paused' | 'ended';
  startAt: string | null;
  endAt: string | null;
  slotCount: number;
  creator: { id: string; slug: string; displayName: string };
  slots: Array<{
    id: string;
    position: number;
    occupied: boolean;
    currentPlacement: null | {
      id: string;
      source: 'free_claim' | 'takeover' | 'admin';
      startedAt: string;
      mediaPath: string | null;
    };
  }>;
};

export class PublicWallApiError extends Error {
  constructor(readonly status: number) {
    super('Public Wall unavailable');
  }
}

export function publicWallApi(origin: string) {
  return {
    async get(id: string, signal?: AbortSignal): Promise<PublicWall> {
      const response = await fetch(
        `${origin}/walls/${encodeURIComponent(id)}`,
        { cache: 'no-store', credentials: 'omit', signal },
      );
      if (!response.ok) throw new PublicWallApiError(response.status);
      return (await response.json()) as PublicWall;
    },
  };
}
