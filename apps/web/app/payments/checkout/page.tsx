import { loadWebConfig } from '@digital-autograph/config';
import { PaidCheckout } from '../../../components/paid-checkout';
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ reservationId?: string; autographId?: string }>;
}) {
  const query = await searchParams;
  const { API_PUBLIC_ORIGIN } = loadWebConfig();
  // No Wall navigation advertises payments. Real unpublished editions fail closed in the API.
  return (
    <main lang="ru">
      <h1>Подтверждение платного размещения</h1>
      <PaidCheckout
        apiOrigin={API_PUBLIC_ORIGIN}
        reservationId={query.reservationId ?? ''}
        autographId={query.autographId ?? ''}
      />
    </main>
  );
}
