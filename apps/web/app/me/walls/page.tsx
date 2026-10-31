import workspaceStyles from '../../../components/workspace.module.css';
import { loadWebConfig } from '@digital-autograph/config';
import { AccountWorkspace } from '../../../components/account-workspace';
import { getTranslator } from '../../../lib/i18n-server';
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };
export default async function Page() {
  const t = await getTranslator();
  return (
    <main className={workspaceStyles.page}>
      <h1>{t('My Walls')}</h1>
      <AccountWorkspace
        apiOrigin={loadWebConfig().API_PUBLIC_ORIGIN}
        section="walls"
      />
    </main>
  );
}
