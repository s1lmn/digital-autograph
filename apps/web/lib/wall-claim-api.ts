export type ReadyAutographChoice = {
  id: string;
  source: 'canvas' | 'photo';
  createdAt: string;
  moderatedAt: string;
};

export class WallClaimApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

async function errorCode(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  if (
    body &&
    typeof body === 'object' &&
    'error' in body &&
    body.error &&
    typeof body.error === 'object' &&
    'code' in body.error &&
    typeof body.error.code === 'string'
  ) {
    return body.error.code;
  }
  return 'REQUEST_FAILED';
}

export function wallClaimApi(origin: string) {
  return {
    async session(
      signal?: AbortSignal,
    ): Promise<'authenticated' | 'anonymous'> {
      const response = await fetch(`${origin}/auth/me`, {
        credentials: 'include',
        cache: 'no-store',
        signal,
      });
      if (response.ok) return 'authenticated';
      if (response.status === 401) return 'anonymous';
      throw new WallClaimApiError('AUTH_UNAVAILABLE', response.status);
    },
    async readyAutographs(
      signal?: AbortSignal,
    ): Promise<ReadyAutographChoice[]> {
      const response = await fetch(`${origin}/autographs?status=ready`, {
        credentials: 'include',
        cache: 'no-store',
        signal,
      });
      if (!response.ok) {
        throw new WallClaimApiError(await errorCode(response), response.status);
      }
      const body = (await response.json()) as { items: ReadyAutographChoice[] };
      return body.items;
    },
    async claim(
      wallId: string,
      slotId: string,
      autographId: string,
      signal?: AbortSignal,
    ) {
      const response = await fetch(
        `${origin}/walls/${encodeURIComponent(wallId)}/slots/${encodeURIComponent(slotId)}/free-claim`,
        {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ autographId }),
          signal,
        },
      );
      if (!response.ok) {
        throw new WallClaimApiError(await errorCode(response), response.status);
      }
      return (await response.json()) as {
        claimId: string;
        wallId: string;
        slotId: string;
        autographId: string;
        placement: { id: string; source: 'free_claim'; startedAt: string };
      };
    },
  };
}
