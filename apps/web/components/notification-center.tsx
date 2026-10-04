'use client';
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
      <h1>Notifications</h1>
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={() => setVersion((v) => v + 1)}
      >
        Refresh
      </button>
      {!preferences && !error && <p role="status">Loading…</p>}
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
              <legend>Preferences</legend>
              <label>
                <input
                  type="checkbox"
                  checked={preferences.web}
                  onChange={(e) =>
                    setPreferences({ ...preferences, web: e.target.checked })
                  }
                />{' '}
                In-app notifications
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
                Telegram notifications
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
                  {kind.replaceAll('_', ' ')}
                </label>
              ))}
              <button type="submit">Save preferences</button>
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
              Connect Telegram and consent to notifications
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
              Disconnect Telegram
            </button>
          )}
          <p>
            You can turn off all channels or individual events. Telegram also
            accepts /stop. No more than one event of each type per Wall in 10
            minutes and 20 per channel per hour.
          </p>
          <h2>Inbox</h2>
          {items.length === 0 ? (
            <p>No notifications.</p>
          ) : (
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <a href={item.deepLink}>{item.title}</a>
                  {item.detail && <p>{item.detail}</p>}
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
                      Mark read
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
