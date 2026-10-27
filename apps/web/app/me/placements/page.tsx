import { localizeMetadata } from '../../../lib/i18n-server';

import { getTranslator } from '../../../lib/i18n-server';
import type { Metadata } from 'next';
import { loadWebConfig } from '@digital-autograph/config';
import { UserPlacementHistory } from '../../../components/placement-history';

const pageMetadata: Metadata = {
  title: 'Your placement history',
  robots: { index: false, follow: false },
};
export async function generateMetadata() {
  return localizeMetadata(pageMetadata);
}

export const dynamic = 'force-dynamic';

export default async function UserPlacementsPage() {
  const t = await getTranslator();

  const { API_PUBLIC_ORIGIN } = loadWebConfig();
  return (
    <main>
      <p className="eyebrow">{t('Destka')}</p>
      <h1>{t('Your placement history')}</h1>
      <p>
        {t(
          'Review current and completed placements associated with your account.',
        )}
      </p>
      <UserPlacementHistory apiOrigin={API_PUBLIC_ORIGIN} />
    </main>
  );
}
