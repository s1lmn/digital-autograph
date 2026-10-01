export type PlacementHistoryItem = {
  wallId: string;
  wallSlug: string;
  wallDisplayName: string;
  wallIsPublic: boolean;
  slotPosition: number;
  source: 'free_claim' | 'takeover' | 'admin';
  startedAt: string;
  endedAt: string | null;
  endReason: 'displaced' | 'wall_ended' | 'administrative' | 'other' | null;
};

export type PublicWallPlacementHistory = {
  wallId: string;
  placements: Array<
    Pick<
      PlacementHistoryItem,
      'slotPosition' | 'source' | 'startedAt' | 'endedAt' | 'endReason'
    >
  >;
};

export class PlacementHistoryApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function requestJson<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T;
  const body: unknown = await response.json().catch(() => null);
  const code =
    body &&
    typeof body === 'object' &&
    'error' in body &&
    body.error &&
    typeof body.error === 'object' &&
    'code' in body.error &&
    typeof body.error.code === 'string'
      ? body.error.code
      : 'REQUEST_FAILED';
  throw new PlacementHistoryApiError(response.status, code);
}

export function placementHistoryApi(origin: string) {
  return {
    async wall(
      wallId: string,
      signal?: AbortSignal,
    ): Promise<PublicWallPlacementHistory> {
      const response = await fetch(
        `${origin}/walls/${encodeURIComponent(wallId)}/placements`,
        { cache: 'no-store', credentials: 'omit', signal },
      );
      return requestJson<PublicWallPlacementHistory>(response);
    },
    async mine(signal?: AbortSignal): Promise<PlacementHistoryItem[]> {
      const response = await fetch(`${origin}/me/placements`, {
        cache: 'no-store',
        credentials: 'include',
        signal,
      });
      const body = await requestJson<{ items: PlacementHistoryItem[] }>(
        response,
      );
      return body.items;
    },
    async session(
      signal?: AbortSignal,
    ): Promise<'authenticated' | 'anonymous'> {
      const response = await fetch(`${origin}/auth/me`, {
        cache: 'no-store',
        credentials: 'include',
        signal,
      });
      if (response.ok) return 'authenticated';
      if (response.status === 401) return 'anonymous';
      throw new PlacementHistoryApiError(response.status, 'AUTH_UNAVAILABLE');
    },
  };
}

export function placementSourceLabel(source: PlacementHistoryItem['source']) {
  switch (source) {
    case 'free_claim':
      return 'Free Claim';
    case 'takeover':
      return 'Paid takeover';
    case 'admin':
      return 'Administrative placement';
  }
}

export function placementEndReasonLabel(
  reason: PlacementHistoryItem['endReason'],
) {
  switch (reason) {
    case 'displaced':
      return 'Replaced by a later placement';
    case 'wall_ended':
      return 'Wall ended';
    case 'administrative':
      return 'Ended by administration';
    case 'other':
      return 'Placement ended';
    case null:
      return null;
  }
}
