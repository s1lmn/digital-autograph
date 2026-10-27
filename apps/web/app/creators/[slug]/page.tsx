import { getTranslator } from '../../../lib/i18n-server';
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
  const t = await getTranslator();
  const parsed = creatorSlugParams.safeParse(await params);
  if (!parsed.success)
    return { title: t('Creator not found'), robots: { index: false } };
  try {
    const creator = await loadCreator(parsed.data.slug);
    const title = t('{name} — public Walls', { name: creator.displayName });
    const description = t('Explore {name}’s public digital autograph Walls.', {
      name: creator.displayName,
    });
    return {
      title,
      description,
      openGraph: { title, description, type: 'website' },
    };
  } catch {
    return { title: t('Creator unavailable'), robots: { index: false } };
  }
}
export default async function CreatorPage({ params }: Props) {
  const t = await getTranslator();

  const parsed = creatorSlugParams.safeParse(await params);
  if (!parsed.success) notFound();
  let creator;
  try {
    creator = await loadCreator(parsed.data.slug);
  } catch (error) {
    if (error instanceof PublicWallApiError && error.status === 404) notFound();
    return (
      <main className="creatorPage">
        <h1>{t('Creator temporarily unavailable')}</h1>
        <p role="alert">{t('Check your connection and try again.')}</p>
        <a className="actionLink" href={`/creators/${parsed.data.slug}`}>
          {t('Retry loading creator')}
        </a>
      </main>
    );
  }
  return (
    <main className="creatorPage">
      <p className="eyebrow">{t('Creator')}</p>
      <h1>{creator.displayName}</h1>
      <h2>{t('Public Walls')}</h2>
      {creator.walls.length === 0 ? (
        <p>{t('No public Walls yet. Check back later.')}</p>
      ) : (
        <ul className="contentList">
          {creator.walls.map((wall) => (
            <li key={wall.id}>
              <h3>
                <a href={`/walls/${wall.id}`}>
                  {t('{name}’s Wall', { name: creator.displayName })}
                </a>
              </h3>
              <p>
                {t('Status: ')}
                {t(wall.status)}
              </p>
              {wall.startAt && (
                <p>
                  {t('Starts:')}{' '}
                  <time dateTime={wall.startAt}>
                    {new Date(wall.startAt)
                      .toISOString()
                      .replace('T', ' ')
                      .slice(0, 16)}{' '}
                    {t('UTC')}
                  </time>
                </p>
              )}
              {wall.endAt && (
                <p>
                  {t('Ends:')}{' '}
                  <time dateTime={wall.endAt}>
                    {new Date(wall.endAt)
                      .toISOString()
                      .replace('T', ' ')
                      .slice(0, 16)}{' '}
                    {t('UTC')}
                  </time>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <p>
        <a href="/autograph/create">{t('Prepare your digital autograph')}</a>
      </p>
    </main>
  );
}
