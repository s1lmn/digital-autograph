import type { Metadata } from 'next';
import { cache } from 'react';
import { loadWebConfig } from '@digital-autograph/config';
import { creatorSlugParams } from '@digital-autograph/contracts';
import { notFound } from 'next/navigation';
import { getPublicCreator } from '../../../lib/public-creator-api';
import { PublicWallApiError } from '../../../lib/public-wall-api';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ slug: string }> };
const loadCreator = cache(async (slug: string) => {
  const { API_INTERNAL_URL } = loadWebConfig();
  return getPublicCreator(API_INTERNAL_URL, slug);
});
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const parsed = creatorSlugParams.safeParse(await params);
  if (!parsed.success)
    return { title: 'Creator not found', robots: { index: false } };
  try {
    const creator = await loadCreator(parsed.data.slug);
    const title = `${creator.displayName} — public Walls`;
    const description = `Explore ${creator.displayName}’s public digital autograph Walls.`;
    return {
      title,
      description,
      openGraph: { title, description, type: 'website' },
    };
  } catch {
    return { title: 'Creator unavailable', robots: { index: false } };
  }
}
export default async function CreatorPage({ params }: Props) {
  const parsed = creatorSlugParams.safeParse(await params);
  if (!parsed.success) notFound();
  let creator;
  try {
    creator = await loadCreator(parsed.data.slug);
  } catch (error) {
    if (error instanceof PublicWallApiError && error.status === 404) notFound();
    return (
      <main>
        <h1>Creator temporarily unavailable</h1>
        <p role="alert">Check your connection and try again.</p>
        <a className="actionLink" href={`/creators/${parsed.data.slug}`}>
          Retry loading creator
        </a>
      </main>
    );
  }
  return (
    <main>
      <p className="eyebrow">Creator</p>
      <h1>{creator.displayName}</h1>
      <h2>Public Walls</h2>
      {creator.walls.length === 0 ? (
        <p>No public Walls yet. Check back later.</p>
      ) : (
        <ul className="contentList">
          {creator.walls.map((wall) => (
            <li key={wall.id}>
              <h3>
                <a href={`/walls/${wall.id}`}>{creator.displayName}’s Wall</a>
              </h3>
              <p>Status: {wall.status}</p>
              {wall.startAt && (
                <p>
                  Starts:{' '}
                  <time dateTime={wall.startAt}>
                    {new Date(wall.startAt)
                      .toISOString()
                      .replace('T', ' ')
                      .slice(0, 16)}{' '}
                    UTC
                  </time>
                </p>
              )}
              {wall.endAt && (
                <p>
                  Ends:{' '}
                  <time dateTime={wall.endAt}>
                    {new Date(wall.endAt)
                      .toISOString()
                      .replace('T', ' ')
                      .slice(0, 16)}{' '}
                    UTC
                  </time>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <p>
        <a href="/autograph/create">Prepare your digital autograph</a>
      </p>
    </main>
  );
}
