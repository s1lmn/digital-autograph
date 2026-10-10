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
  const destination =
    returnTo === '/autograph/create' ||
    /^\/walls\/[a-f0-9-]{36}$/.test(returnTo ?? '')
      ? returnTo!
      : '/autograph/create';
  return (
    <main lang="ru">
      <h1>Подтверждения для Destka</h1>
      <FirstUseGate apiOrigin={loadWebConfig().API_PUBLIC_ORIGIN}>
        <p>Подтверждения сохранены.</p>
        <a href={destination}>Вернуться к действию</a>
      </FirstUseGate>
    </main>
  );
}
