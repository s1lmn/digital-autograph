import type { Metadata } from 'next';
type AuthErrorPageProps = {
  searchParams: Promise<{ code?: string | string[] }>;
};

export const metadata: Metadata = {
  title: 'Sign-in',
  robots: { index: false, follow: false },
};

export default async function AuthErrorPage({
  searchParams,
}: AuthErrorPageProps) {
  const { code } = await searchParams;
  const messages: Record<string, string> = {
    GOOGLE_AUTH_CANCELLED: 'Google sign-in was cancelled.',
    GOOGLE_AUTH_FAILED: 'Google sign-in could not be completed.',
    TELEGRAM_AUTH_CANCELLED: 'Telegram sign-in was cancelled.',
    TELEGRAM_AUTH_FAILED: 'Telegram sign-in could not be completed.',
    ALREADY_AUTHENTICATED: 'You are already signed in.',
  };
  const message =
    typeof code === 'string'
      ? (messages[code] ?? 'Sign-in could not be completed.')
      : 'Sign-in could not be completed.';

  return (
    <main>
      <p className="eyebrow">Digital Autograph Platform</p>
      <h1>Sign-in</h1>
      <p>{message}</p>
      <a href="/">Return home</a>
    </main>
  );
}
