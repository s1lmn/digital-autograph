import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: {
    default: 'Digital Autograph Platform',
    template: '%s | Digital Autograph',
  },
  description:
    'Create a private digital autograph and leave your mark on a creator’s Wall.',
  openGraph: {
    title: 'Digital Autograph Platform',
    description:
      'Create a private digital autograph and leave your mark on a creator’s Wall.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skipLink" href="#main-content">
          Skip to content
        </a>
        <header className="siteHeader">
          <nav className="siteNav" aria-label="Main navigation">
            <a className="brand" href="/">
              Digital Autograph
            </a>
            <a href="/autograph/create">Create autograph</a>
            <a href="/me">Your account</a>
            <a href="/me/placements">Placement history</a>
            <a href="/me/notifications">Notifications</a>
          </nav>
        </header>
        <div id="main-content" tabIndex={-1}>
          {children}
        </div>
        <footer className="siteFooter" lang="ru">
          <nav aria-label="Юридическая информация">
            <a href="/legal">Юридические документы Destka</a>
          </nav>
        </footer>
      </body>
    </html>
  );
}
