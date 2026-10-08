import { loadWebConfig } from '@digital-autograph/config';
import { NotificationCenter } from '../../../components/notification-center';
export const metadata = {
  title: 'Notifications',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';
export default function Page() {
  return <NotificationCenter apiOrigin={loadWebConfig().API_PUBLIC_ORIGIN} />;
}
