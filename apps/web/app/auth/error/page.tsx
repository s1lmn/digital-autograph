import { localizeMetadata } from '../../../lib/i18n-server';

import { getTranslator } from '../../../lib/i18n-server';
import type { Metadata } from 'next';
type AuthErrorPageProps = {
  searchParams: Promise<{ code?: string | string[] }>;
};

const pageMetadata: Metadata = {
  title: 'Sign-in',
  robots: { index: false, follow: false },
};
export async function generateMetadata() {
  return localizeMetadata(pageMetadata);
}

export default async function AuthErrorPage({
  searchParams,
}: AuthErrorPageProps) {
  const t = await getTranslator();

  const { code } = await searchParams;
  const messages: Record<string, string> = {
    GOOGLE_AUTH_CANCELLED: 'Google sign-in was cancelled.',
    GOOGLE_AUTH_FAILED: 'Google sign-in could not be completed.',
    TELEGRAM_AUTH_CANCELLED: 'Telegram sign-in was cancelled.',
    TELEGRAM_AUTH_FAILED: 'Telegram sign-in could not be completed.',
    YANDEX_AUTH_CANCELLED: 'Вход через Яндекс ID отменён.',
    YANDEX_AUTH_FAILED: 'Не удалось завершить вход через Яндекс ID.',
    VK_AUTH_CANCELLED: 'Вход через VK ID отменён.',
    VK_AUTH_FAILED: 'Не удалось завершить вход через VK ID.',
    ALREADY_AUTHENTICATED: 'You are already signed in.',
  };
  const message =
    typeof code === 'string'
      ? (messages[code] ?? 'Sign-in could not be completed.')
      : 'Sign-in could not be completed.';

  return (
    <main>
      <p className="eyebrow">{t('Destka')}</p>
      <h1>{t('Sign-in')}</h1>
      <p>{t(message)}</p>
      <a href="/">{t('Return home')}</a>
    </main>
  );
}
