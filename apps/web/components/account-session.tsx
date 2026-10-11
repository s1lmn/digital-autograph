'use client';

import { VkIdSignIn } from './vk-id-sign-in';

import { useEffect, useRef, useState } from 'react';
import { wallClaimApi } from '../lib/wall-claim-api';

export function AccountSession({ apiOrigin }: { apiOrigin: string }) {
  const [auth, setAuth] = useState<
    'checking' | 'authenticated' | 'anonymous' | 'unavailable'
  >('checking');
  const [retry, setRetry] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const logoutPending = useRef(false);
  const logoutController = useRef<AbortController | null>(null);
  useEffect(() => () => logoutController.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    wallClaimApi(apiOrigin)
      .session(controller.signal)
      .then((state) => {
        if (!controller.signal.aborted) setAuth(state);
      })
      .catch(() => {
        if (!controller.signal.aborted) setAuth('unavailable');
      });
    return () => controller.abort();
  }, [apiOrigin, retry]);

  const logout = async () => {
    if (logoutPending.current) return;
    logoutPending.current = true;
    const controller = new AbortController();
    logoutController.current = controller;
    setLoggingOut(true);
    setLogoutError(false);
    try {
      const response = await fetch(`${apiOrigin}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Logout failed');
      if (!controller.signal.aborted) setAuth('anonymous');
    } catch {
      if (!controller.signal.aborted) setLogoutError(true);
    } finally {
      logoutPending.current = false;
      if (!controller.signal.aborted) setLoggingOut(false);
    }
  };

  if (auth === 'checking') return <p role="status">Checking sign-in…</p>;
  if (auth === 'unavailable')
    return (
      <section>
        <p role="alert">
          Sign-in is temporarily unavailable. Check your connection and try
          again.
        </p>
        <button
          type="button"
          onClick={() => {
            setAuth('checking');
            setRetry((value) => value + 1);
          }}
        >
          Retry sign-in check
        </button>
      </section>
    );
  if (auth === 'anonymous')
    return (
      <section aria-labelledby="account-sign-in">
        <h2 id="account-sign-in">Sign in to continue</h2>
        <p>
          Your autograph and placement history are associated with your account.
        </p>
        <div className="linkActions">
          <a href={`${apiOrigin}/auth/google/start?returnTo=%2Fme`}>
            Continue with Google
          </a>
          <a href={`${apiOrigin}/auth/telegram/start?returnTo=%2Fme`}>
            Continue with Telegram
          </a>
          <VkIdSignIn apiOrigin={apiOrigin} returnTo="/me" />
        </div>
        <p>
          If sign-in cannot open inside this app, open this page in Safari or
          Chrome and try again.
        </p>
      </section>
    );
  return (
    <section aria-labelledby="account-session">
      <h2 id="account-session">You are signed in</h2>
      <div className="linkActions">
        <a href="/autograph/create">Create a digital autograph</a>
        <a href="/me/placements">Your placement history</a>
      </div>
      {logoutError && (
        <p role="alert">
          Sign-out could not be confirmed. Check your connection and retry.
        </p>
      )}
      <p>
        <button type="button" disabled={loggingOut} onClick={logout}>
          {loggingOut
            ? 'Signing out…'
            : logoutError
              ? 'Retry sign out'
              : 'Sign out'}
        </button>
      </p>
    </section>
  );
}
