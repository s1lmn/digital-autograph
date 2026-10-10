import type { Metadata } from 'next';
// Until owner approval, no legal route is indexed, including empty/unavailable SSR.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: { default: 'Документы | Destka', template: '%s | Destka' },
};
export const dynamic = 'force-dynamic';
export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
