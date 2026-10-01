import { loadWebConfig } from '@digital-autograph/config';
import { CanvasAuthGate } from '../../../components/canvas-auth-gate';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export default function CreateAutographPage() {
  const { API_PUBLIC_ORIGIN } = loadWebConfig();
  return (
    <main className={styles.page}>
      <p className="eyebrow">Digital Autograph Platform</p>
      <h1>Create a digital autograph</h1>
      <p className={styles.intro}>
        Draw or upload a photo, edit it privately, and review the cleaned
        result.
      </p>
      <aside className={styles.warning}>
        This autograph may become public after a later approval step. Do not use
        a bank, legal, or other sensitive signature.
      </aside>
      <CanvasAuthGate apiOrigin={API_PUBLIC_ORIGIN} />
    </main>
  );
}
