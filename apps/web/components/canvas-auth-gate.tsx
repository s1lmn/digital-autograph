'use client';

import { useEffect, useState } from 'react';
import { CanvasCreateScreen } from './canvas-create-screen';
import styles from '../app/autograph/create/page.module.css';

type AuthState = 'checking' | 'authenticated' | 'anonymous' | 'unavailable';

export function CanvasAuthGate({ apiOrigin }: { apiOrigin: string }) {
  const [auth, setAuth] = useState<AuthState>('checking');

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiOrigin}/auth/me`, {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => {
        if (response.ok) setAuth('authenticated');
        else setAuth(response.status === 401 ? 'anonymous' : 'unavailable');
      })
      .catch(() => {
        if (!controller.signal.aborted) setAuth('unavailable');
      });
    return () => controller.abort();
  }, [apiOrigin]);

  const returnTo = encodeURIComponent('/autograph/create');
  if (auth === 'checking') return <p role="status">Checking sign-in…</p>;
  if (auth === 'authenticated')
    return <CanvasCreateScreen apiOrigin={apiOrigin} />;
  if (auth === 'anonymous') {
    return (
      <section className={styles.auth} aria-labelledby="sign-in-heading">
        <h2 id="sign-in-heading">Sign in to continue</h2>
        <p>Your drawing will start after sign-in.</p>
        <div className={styles.links}>
          <a href={`${apiOrigin}/auth/google/start?returnTo=${returnTo}`}>
            Continue with Google
          </a>
          <a href={`${apiOrigin}/auth/telegram/start?returnTo=${returnTo}`}>
            Continue with Telegram
          </a>
        </div>
      </section>
    );
  }
  return (
    <section role="alert" className={styles.auth}>
      <h2>Sign-in is temporarily unavailable</h2>
      <p>Refresh this page when the API is available.</p>
    </section>
  );
}
