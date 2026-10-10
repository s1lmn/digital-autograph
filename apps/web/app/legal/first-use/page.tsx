import { checkoutQuerySchema } from '@digital-autograph/contracts';
import { loadWebConfig } from '@digital-autograph/config';
import { FirstUseGate } from '../../../components/first-use-gate';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Перед первым действием | Destka',
  robots: { index: false, follow: false },
};
export default async function FirstUsePage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;
  // Only known interactive destinations, never an external/user-supplied redirect.
  let checkoutDestination = '';
  if (returnTo?.startsWith('/payments/checkout?')) {
    const u = new URL(returnTo, 'https://destka.invalid');
    const values = Object.fromEntries(u.searchParams);
    if (
      !u.hash &&
      u.searchParams.size === 2 &&
      checkoutQuerySchema.safeParse(values).success
    )
      checkoutDestination = returnTo;
  }
  const destination =
    returnTo === '/autograph/create' ||
    /^\/walls\/[a-f0-9-]{36}$/.test(returnTo ?? '')
      ? returnTo!
      : checkoutDestination || '/autograph/create';
  return (
    <main lang="ru">
      <h1>Подтверждения для Destka</h1>
      <FirstUseGate
        apiOrigin={loadWebConfig().API_PUBLIC_ORIGIN}
        loginReturnTo={`/legal/first-use?returnTo=${encodeURIComponent(destination)}`}
      >
        <p>Подтверждения сохранены.</p>
        <a href={destination}>Вернуться к действию</a>
      </FirstUseGate>
    </main>
  );
}
