import type { PublicWall } from './public-wall-api';
import { PublicWallApiError } from './public-wall-api';

export type PublicCreator = {
  id: string;
  slug: string;
  displayName: string;
  walls: Array<Pick<PublicWall, 'id' | 'status' | 'startAt' | 'endAt'>>;
};

export async function getPublicCreator(
  origin: string,
  slug: string,
): Promise<PublicCreator> {
  const response = await fetch(
    `${origin}/creators/${encodeURIComponent(slug)}`,
    {
      cache: 'no-store',
      credentials: 'omit',
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!response.ok) throw new PublicWallApiError(response.status);
  return (await response.json()) as PublicCreator;
}
