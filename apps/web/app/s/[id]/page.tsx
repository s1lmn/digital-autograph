import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { loadWebConfig } from '@digital-autograph/config';
import { notificationIdParams } from '@digital-autograph/contracts';
import { ShareReferral } from '../../../components/share-referral';
type Share = {
  id: string;
  wallId: string;
  slotId: string | null;
  creator: string;
  slotNumber: number | null;
  publicAlias: string | null;
  event: string;
};
export const dynamic = 'force-dynamic';
const load = cache(async (id: string): Promise<Share> => {
  if (!notificationIdParams.safeParse({ id }).success) notFound();
  const response = await fetch(
    `${loadWebConfig().API_INTERNAL_URL}/public/shares/${id}`,
    { cache: 'no-store', signal: AbortSignal.timeout(5000) },
  );
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error('Share temporarily unavailable');
  return response.json();
});
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const share = await load(id);
  const title = `${share.creator} · ${share.slotNumber === null ? 'Final Wall' : `Slot ${share.slotNumber}`}`;
  const description = share.publicAlias
    ? `${share.publicAlias} left a mark. View the Wall.`
    : 'View this digital autograph Wall.';
  const image = {
    url: `${loadWebConfig().API_PUBLIC_ORIGIN}/public/shares/${id}/card`,
    width: 1200,
    height: 630,
    alt: title,
  };
  return {
    title,
    description,
    robots: { index: false },
    openGraph: { title, description, type: 'website', images: [image] },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image.url],
    },
  };
}
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const share = await load((await params).id);
  const apiOrigin = loadWebConfig().API_PUBLIC_ORIGIN;
  const destination = `/walls/${share.wallId}${share.slotId ? `#slot-${share.slotId}` : ''}`;
  return (
    <main>
      <h1>{share.creator}</h1>
      <p>
        {share.slotNumber === null ? 'Final Wall' : `Slot ${share.slotNumber}`}
      </p>
      {share.publicAlias && <p>{share.publicAlias}</p>}
      <img
        src={`${apiOrigin}/public/shares/${share.id}/card`}
        width="1200"
        height="630"
        style={{ maxWidth: '100%', height: 'auto' }}
        alt="Digital autograph share card"
      />
      <a className="actionLink" href={destination}>
        View the Wall
      </a>
      <ShareReferral shareId={share.id} apiOrigin={apiOrigin} />
    </main>
  );
}
