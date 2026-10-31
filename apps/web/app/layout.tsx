import { localizeMetadata } from '../lib/i18n-server';

import { getLocale, getTranslator } from '../lib/i18n-server';
import type { Metadata } from 'next';
import { WorkspaceNavigation } from '../components/workspace-navigation';
import { loadWebConfig } from '@digital-autograph/config';
import { themeInitScript } from '../lib/theme-init';
import './styles.css';
import { LocaleProvider } from '../components/locale-provider';

const pageMetadata: Metadata = {
  title: {
    default: 'Destka',
    template: '%s | Destka',
  },
  description:
    'Create a private digital autograph and leave your mark on a creator’s Wall.',
  openGraph: {
    title: 'Destka',
    description:
      'Create a private digital autograph and leave your mark on a creator’s Wall.',
    type: 'website',
  },
};
export async function generateMetadata() {
  return localizeMetadata(pageMetadata);
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const t = await getTranslator();
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <LocaleProvider initialLocale={locale}>
          <a className="skipLink" href="#main-content">
            {t('Skip to content')}
          </a>
          <WorkspaceNavigation apiOrigin={loadWebConfig().API_PUBLIC_ORIGIN} />
          <div id="main-content" tabIndex={-1}>
            {children}
          </div>
          <footer className="siteFooter">
            <div className="footerInner">
              <a className="footerBrand" href="/">
                {t('Destka.')}
              </a>
              <p>{t('A little ink. A shared story.')}</p>
              <nav aria-label={t('Юридическая информация')}>
                <a href="/legal">{t('Юридические документы Destka')}</a>
              </nav>
            </div>
          </footer>
        </LocaleProvider>
      </body>
    </html>
  );
}
