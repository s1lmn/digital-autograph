import type { Metadata } from 'next';
import { loadWebConfig } from '@digital-autograph/config';
import { AccountSession } from '../../components/account-session';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Your account',
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  const { API_PUBLIC_ORIGIN } = loadWebConfig();
  return (
    <main>
      <h1>Your account</h1>
      <AccountSession apiOrigin={API_PUBLIC_ORIGIN} />
    </main>
  );
}
