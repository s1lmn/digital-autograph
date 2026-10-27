import { localizeMetadata } from '../lib/i18n-server';

import { getLocale, getTranslator } from '../lib/i18n-server';
import type { Metadata } from 'next';
import { BrandMark, Icon } from '../components/ui-icon';
import { ThemeSwitcher } from '../components/theme-switcher';
import { themeInitScript } from '../lib/theme-init';
import './styles.css';
import { LocaleProvider } from '../components/locale-provider';
import { LanguageSwitcher } from '../components/language-switcher';

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
          <header className="siteHeader">
            <nav className="siteNav" aria-label={t('Main navigation')}>
              <a className="brand" href="/">
                <BrandMark />
                <span>
                  {t('Destka')}
                  <span className="brandDot">.</span>
                </span>
              </a>
              <div className="navLinks">
                <a href="/me/placements">
                  <Icon name="history" />
                  <span>{t('Placement history')}</span>
                </a>
                <a href="/me/notifications">
                  <Icon name="bell" />
                  <span>{t('Notifications')}</span>
                </a>
                <a href="/me">
                  <Icon name="user" />
                  <span>{t('Your account')}</span>
                </a>
              </div>
              <ThemeSwitcher />
              <LanguageSwitcher />
              <a className="navCreate" href="/autograph/create">
                <Icon name="pen" />
                <span>{t('Create autograph')}</span>
              </a>
            </nav>
          </header>
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
