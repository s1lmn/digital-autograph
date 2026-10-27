'use client';
import { useLocale } from './locale-provider';

import { YandexSignIn } from './yandex-sign-in';
import { VkIdSignIn } from './vk-id-sign-in';

import { useEffect, useState } from 'react';
import { FirstUseGate } from './first-use-gate';
import { CanvasCreateScreen } from './canvas-create-screen';
import styles from '../app/autograph/create/page.module.css';

type AuthState = 'checking' | 'authenticated' | 'anonymous' | 'unavailable';

export function CanvasAuthGate({ apiOrigin }: { apiOrigin: string }) {
  const { t } = useLocale();

  const [auth, setAuth] = useState<AuthState>('checking');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiOrigin}/auth/me`, {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => {
        if (controller.signal.aborted) return;
        if (response.ok) setAuth('authenticated');
        else setAuth(response.status === 401 ? 'anonymous' : 'unavailable');
      })
      .catch(() => {
        if (!controller.signal.aborted) setAuth('unavailable');
      });
    return () => controller.abort();
  }, [apiOrigin, retry]);

  const returnTo = encodeURIComponent('/autograph/create');
  if (auth === 'checking') return <p role="status">{t('Checking sign-in…')}</p>;
  if (auth === 'authenticated')
    return (
      <FirstUseGate apiOrigin={apiOrigin}>
        <CanvasCreateScreen apiOrigin={apiOrigin} />
      </FirstUseGate>
    );
  if (auth === 'anonymous') {
    return (
      <section className={styles.auth} aria-labelledby="sign-in-heading">
        <h2 id="sign-in-heading">{t('Sign in to continue')}</h2>
        <p>{t('Your autograph creation will start after sign-in.')}</p>
        <div className={styles.links}>
          <a href={`${apiOrigin}/auth/google/start?returnTo=${returnTo}`}>
            {t('Continue with Google')}
          </a>
          <a href={`${apiOrigin}/auth/telegram/start?returnTo=${returnTo}`}>
            {t('Continue with Telegram')}
          </a>
          <YandexSignIn apiOrigin={apiOrigin} returnTo="/autograph/create" />
          <VkIdSignIn apiOrigin={apiOrigin} returnTo="/autograph/create" />
        </div>
        <p>
          {t(
            'If sign-in cannot open inside this app, open this page in Safari or Chrome and try again.',
          )}
        </p>
      </section>
    );
  }
  return (
    <section role="alert" className={styles.auth}>
      <h2>{t('Sign-in is temporarily unavailable')}</h2>
      <p>{t('Check your connection and try again.')}</p>
      <button
        type="button"
        onClick={() => {
          setAuth('checking');
          setRetry((count) => count + 1);
        }}
      >
        {t('Retry sign-in check')}
      </button>
    </section>
  );
}
