import { localizeMetadata } from '../../lib/i18n-server';
import type { Metadata } from 'next';
// Until owner approval, no legal route is indexed, including empty/unavailable SSR.
const pageMetadata: Metadata = {
  robots: { index: false, follow: false },
  title: { default: 'Документы | Destka', template: '%s | Destka' },
};
export async function generateMetadata() {
  return localizeMetadata(pageMetadata);
}
export const dynamic = 'force-dynamic';
export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
