import type { Metadata } from 'next';
import { cache } from 'react';
import { loadWebConfig } from '@digital-autograph/config';
import { wallIdParams } from '@digital-autograph/contracts';
import { notFound } from 'next/navigation';
import { PublicWallScreen } from '../../../components/public-wall-screen';
import {
  PublicWallApiError,
  publicWallApi,
} from '../../../lib/public-wall-api';

export const dynamic = 'force-dynamic';

const loadWall = cache(async (id: string) => {
  const { API_INTERNAL_URL } = loadWebConfig();
  return publicWallApi(API_INTERNAL_URL).get(id, AbortSignal.timeout(5000));
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const parsed = wallIdParams.safeParse(await params);
  if (!parsed.success)
    return { title: 'Wall not found', robots: { index: false } };
  try {
    const wall = await loadWall(parsed.data.id);
    const title = `${wall.creator.displayName}'s Wall`;
    const description = `View ${wall.creator.displayName}’s digital autograph Wall and its public placement history.`;
    return {
      title,
      description,
      openGraph: { title, description, type: 'website' },
    };
  } catch {
    return { title: 'Wall unavailable', robots: { index: false } };
  }
}

export default async function WallPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const parsed = wallIdParams.safeParse(await params);
  if (!parsed.success) notFound();
  const { API_PUBLIC_ORIGIN } = loadWebConfig();
  try {
    const wall = await loadWall(parsed.data.id);
    return (
      <PublicWallScreen initialWall={wall} apiOrigin={API_PUBLIC_ORIGIN} />
    );
  } catch (error) {
    if (error instanceof PublicWallApiError && error.status === 404) {
      notFound();
    }
    return (
      <main>
        <h1>Wall temporarily unavailable</h1>
        <p role="alert">Check your connection and try again.</p>
        <a className="actionLink" href={`/walls/${parsed.data.id}`}>
          Retry loading Wall
        </a>
      </main>
    );
  }
}
