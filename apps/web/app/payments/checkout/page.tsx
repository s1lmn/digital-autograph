import { localizeMetadata } from '../../../lib/i18n-server';

import { getTranslator } from '../../../lib/i18n-server';
import { loadWebConfig } from '@digital-autograph/config';
import { PaidCheckout } from '../../../components/paid-checkout';
export const dynamic = 'force-dynamic';
const pageMetadata = { robots: { index: false, follow: false } };
export async function generateMetadata() {
  return localizeMetadata(pageMetadata);
}
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ reservationId?: string; autographId?: string }>;
}) {
  const t = await getTranslator();

  const query = await searchParams;
  const { API_PUBLIC_ORIGIN } = loadWebConfig();
  // No Wall navigation advertises payments. Real unpublished editions fail closed in the API.
  return (
    <main>
      <h1>{t('Подтверждение платного размещения')}</h1>
      <PaidCheckout
        apiOrigin={API_PUBLIC_ORIGIN}
        reservationId={query.reservationId ?? ''}
        autographId={query.autographId ?? ''}
      />
    </main>
  );
}
