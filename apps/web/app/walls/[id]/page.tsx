import { loadWebConfig } from '@digital-autograph/config';
import { wallIdParams } from '@digital-autograph/contracts';
import { notFound } from 'next/navigation';
import { PublicWallScreen } from '../../../components/public-wall-screen';
import { WallPlacementHistory } from '../../../components/placement-history';
import {
  PublicWallApiError,
  publicWallApi,
} from '../../../lib/public-wall-api';

export const dynamic = 'force-dynamic';

export default async function WallPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const parsed = wallIdParams.safeParse(await params);
  if (!parsed.success) notFound();
  const { API_INTERNAL_URL, API_PUBLIC_ORIGIN } = loadWebConfig();
  try {
    const wall = await publicWallApi(API_INTERNAL_URL).get(
      parsed.data.id,
      AbortSignal.timeout(5000),
    );
    return (
      <>
        <PublicWallScreen initialWall={wall} apiOrigin={API_PUBLIC_ORIGIN} />
        <WallPlacementHistory wallId={wall.id} apiOrigin={API_PUBLIC_ORIGIN} />
      </>
    );
  } catch (error) {
    if (error instanceof PublicWallApiError && error.status === 404) {
      notFound();
    }
    return (
      <main>
        <h1>Wall temporarily unavailable</h1>
        <p>Please try again shortly.</p>
      </main>
    );
  }
}
