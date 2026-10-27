import { getTranslator } from '../../../lib/i18n-server';
import { loadWebConfig } from '@digital-autograph/config';
import { PaymentReturn } from '../../../components/payment-return';
export const dynamic = 'force-dynamic';
export default async function PaymentReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}) {
  const t = await getTranslator();

  const { orderId } = await searchParams;
  const { API_PUBLIC_ORIGIN } = loadWebConfig();
  return (
    <main>
      <h1>{t('Payment status')}</h1>
      <p>
        {t(
          'Returning from checkout does not confirm payment. We verify the payment with the provider.',
        )}
      </p>
      <PaymentReturn apiOrigin={API_PUBLIC_ORIGIN} orderId={orderId ?? ''} />
    </main>
  );
}
