import { localizeMetadata } from '../../lib/i18n-server';
import type { Metadata } from 'next';
const pageMetadata: Metadata = {
  robots: { index: false, follow: false },
  title: { default: 'Безопасность | Destka', template: '%s | Destka' },
};
export async function generateMetadata() {
  return localizeMetadata(pageMetadata);
}
export const dynamic = 'force-dynamic';
export default function SecurityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
