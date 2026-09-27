import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'Digital Autograph Platform',
  description: 'Create and review a digital autograph.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
