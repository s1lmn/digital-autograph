import type { Metadata } from 'next';
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: { default: 'Безопасность | Destka', template: '%s | Destka' },
};
export const dynamic = 'force-dynamic';
export default function SecurityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
