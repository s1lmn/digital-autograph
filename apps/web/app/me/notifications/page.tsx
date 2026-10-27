import { localizeMetadata } from '../../../lib/i18n-server';
import { loadWebConfig } from '@digital-autograph/config';
import { NotificationCenter } from '../../../components/notification-center';
const pageMetadata = {
  title: 'Notifications',
  robots: { index: false, follow: false },
};
export async function generateMetadata() {
  return localizeMetadata(pageMetadata);
}
export const dynamic = 'force-dynamic';
export default function Page() {
  return <NotificationCenter apiOrigin={loadWebConfig().API_PUBLIC_ORIGIN} />;
}
