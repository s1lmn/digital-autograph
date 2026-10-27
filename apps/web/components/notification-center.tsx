'use client';
import { useLocale } from './locale-provider';

import { useEffect, useState } from 'react';
import { notificationKinds } from '@digital-autograph/domain';
import styles from './notification-panel.module.css';
import {
  notificationRequest as request,
  NotificationApiError,
} from '../lib/notification-api';
type Pref = {
  web: boolean;
  telegram: boolean;
  mutedKinds: string[];
  telegramLinked: boolean;
  telegramAvailable: boolean;
};
type Item = {
  id: string;
  title: string;
  detail: string | null;
  deepLink: string;
  readAt: string | null;
};
export function NotificationCenter({ apiOrigin }: { apiOrigin: string }) {
  const { t } = useLocale();

  const [preferences, setPreferences] = useState<Pref | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setPreferences(null);
    setItems([]);
    setError('');
    Promise.all([
      request<Pref>(apiOrigin, '/me/notifications/preferences'),
      request<Item[]>(apiOrigin, '/me/notifications'),
    ])
      .then(([p, i]) => {
        if (active) {
          setPreferences(p);
          setItems(i);
        }
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, [apiOrigin, version]);
  async function act(operation: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await operation();
      setVersion((v) => v + 1);
    } catch (e) {
      if (e instanceof NotificationApiError && e.status === 401) {
        setPreferences(null);
        setItems([]);
      }
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className={styles.panel}>
      <h1>{t('Notifications')}</h1>
      {error && <p role="alert">{t(error)}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={() => setVersion((v) => v + 1)}
      >
        {t('Refresh')}
      </button>
      {!preferences && !error && <p role="status">{t('Loading…')}</p>}
      {preferences && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(() =>
                request(apiOrigin, '/me/notifications/preferences', 'PUT', {
                  web: preferences.web,
                  telegram: preferences.telegram,
                  mutedKinds: preferences.mutedKinds,
                }),
              );
            }}
          >
            <fieldset disabled={busy}>
              <legend>{t('Preferences')}</legend>
              <label>
                <input
                  type="checkbox"
                  checked={preferences.web}
                  onChange={(e) =>
                    setPreferences({ ...preferences, web: e.target.checked })
                  }
                />{' '}
                {t('In-app notifications')}
              </label>
              <label>
                <input
                  type="checkbox"
                  disabled={!preferences.telegramLinked}
                  checked={preferences.telegram}
                  onChange={(e) =>
                    setPreferences({
                      ...preferences,
                      telegram: e.target.checked,
                    })
                  }
                />{' '}
                {t('Telegram notifications')}
              </label>
              {notificationKinds.map((kind) => (
                <label key={kind}>
                  <input
                    type="checkbox"
                    checked={!preferences.mutedKinds.includes(kind)}
                    onChange={(e) =>
                      setPreferences({
                        ...preferences,
                        mutedKinds: e.target.checked
                          ? preferences.mutedKinds.filter((k) => k !== kind)
                          : [...preferences.mutedKinds, kind],
                      })
                    }
                  />{' '}
                  {t(kind.replaceAll('_', ' '))}
                </label>
              ))}
              <button type="submit">{t('Save preferences')}</button>
            </fieldset>
          </form>
          {preferences.telegramAvailable && !preferences.telegramLinked && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const link = await request<{ url: string }>(
                    apiOrigin,
                    '/me/notifications/telegram/link',
                    'POST',
                  );
                  window.location.assign(link.url);
                })
              }
            >
              {t('Connect Telegram and consent to notifications')}
            </button>
          )}
          {preferences.telegramLinked && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  request(apiOrigin, '/me/notifications/telegram', 'DELETE'),
                )
              }
            >
              {t('Disconnect Telegram')}
            </button>
          )}
          <p>
            {t(
              'You can turn off all channels or individual events. Telegram also accepts /stop. Ordinary notices of the same type are limited to one per Wall in 10 minutes. Financial notices are not combined by that short window. All channels remain limited to 20 notices per hour.',
            )}
          </p>
          <h2>{t('Inbox')}</h2>
          {items.length === 0 ? (
            <p>{t('No notifications.')}</p>
          ) : (
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <a href={item.deepLink}>{t(item.title)}</a>
                  {item.detail && <p>{t(item.detail)}</p>}
                  {!item.readAt && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          request(
                            apiOrigin,
                            `/me/notifications/${item.id}/read`,
                            'POST',
                          ),
                        )
                      }
                    >
                      {t('Mark read')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
