import { getTranslator } from '../../lib/i18n-server';
import { loadWebConfig } from '@digital-autograph/config';
import { ModerationWorkspace } from '../../components/moderation-workspace';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export default async function ModerationPage() {
  const t = await getTranslator();

  const { API_PUBLIC_ORIGIN } = loadWebConfig();
  return (
    <main className={styles.page}>
      <h1>{t('Autograph moderation')}</h1>
      <p>
        {t(
          'Review the owner-approved cleaned image before making a final decision.',
        )}
      </p>
      <ModerationWorkspace apiOrigin={API_PUBLIC_ORIGIN} />
    </main>
  );
}
