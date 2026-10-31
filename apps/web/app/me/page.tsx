import workspaceStyles from '../../components/workspace.module.css';
import { localizeMetadata } from '../../lib/i18n-server';

import { getTranslator } from '../../lib/i18n-server';
import type { Metadata } from 'next';
import { loadWebConfig } from '@digital-autograph/config';
import { AccountWorkspace } from '../../components/account-workspace';

export const dynamic = 'force-dynamic';
const pageMetadata: Metadata = {
  title: 'Your account',
  robots: { index: false, follow: false },
};
export async function generateMetadata() {
  return localizeMetadata(pageMetadata);
}

export default async function AccountPage() {
  const t = await getTranslator();

  const { API_PUBLIC_ORIGIN } = loadWebConfig();
  return (
    <main className={workspaceStyles.page}>
      <h1>{t('Your account')}</h1>
      <AccountWorkspace apiOrigin={API_PUBLIC_ORIGIN} />
    </main>
  );
}
