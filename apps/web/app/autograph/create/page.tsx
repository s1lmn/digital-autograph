import { localizeMetadata } from '../../../lib/i18n-server';

import { getTranslator } from '../../../lib/i18n-server';
import type { Metadata } from 'next';
import { loadWebConfig } from '@digital-autograph/config';
import { CanvasAuthGate } from '../../../components/canvas-auth-gate';
import styles from './page.module.css';
import { Icon } from '../../../components/ui-icon';

const pageMetadata: Metadata = {
  title: 'Create a digital autograph',
  robots: { index: false, follow: false },
};
export async function generateMetadata() {
  return localizeMetadata(pageMetadata);
}

export const dynamic = 'force-dynamic';

export default async function CreateAutographPage() {
  const t = await getTranslator();

  const { API_PUBLIC_ORIGIN } = loadWebConfig();
  return (
    <main className={styles.page}>
      <p className="eyebrow">{t('Your autograph studio')}</p>
      <h1>{t('Create a digital autograph')}</h1>
      <p className={styles.intro}>
        {t(
          'Draw or upload a photo, edit it privately, and review the cleaned result.',
        )}
      </p>
      <aside className={styles.warning}>
        <Icon name="lock" size={17} />
        <span>
          {t(
            'This autograph may become public after a later approval step. Do not use a bank, legal, or other sensitive signature.',
          )}
        </span>
      </aside>
      <CanvasAuthGate apiOrigin={API_PUBLIC_ORIGIN} />
    </main>
  );
}
