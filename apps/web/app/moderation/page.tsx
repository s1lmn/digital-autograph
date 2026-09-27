import { loadWebConfig } from '@digital-autograph/config';
import { ModerationWorkspace } from '../../components/moderation-workspace';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export default function ModerationPage() {
  const { API_PUBLIC_ORIGIN } = loadWebConfig();
  return (
    <main className={styles.page}>
      <h1>Autograph moderation</h1>
      <p>
        Review the owner-approved cleaned image before making a final decision.
      </p>
      <ModerationWorkspace apiOrigin={API_PUBLIC_ORIGIN} />
    </main>
  );
}
