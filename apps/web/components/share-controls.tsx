'use client';
import { useLocale } from './locale-provider';

import { useState } from 'react';
import { notificationRequest as request } from '../lib/notification-api';
import styles from './notification-panel.module.css';
export function ShareControls({
  apiOrigin,
  wallId,
  slots,
}: {
  apiOrigin: string;
  wallId: string;
  slots: Array<{ id: string; position: number }>;
}) {
  const { t } = useLocale();

  const [slotId, setSlotId] = useState('');
  const [alias, setAlias] = useState('');
  const [consent, setConsent] = useState(false);
  const [shareId, setShareId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');
  async function action(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const url =
    shareId && typeof window !== 'undefined'
      ? `${window.location.origin}/s/${shareId}`
      : '';
  return (
    <section
      className={styles.panel}
      aria-label={t('Sharing and Wall notifications')}
    >
      <h2>{t('Share your place')}</h2>
      <p>
        {t(
          'Create a card for your own placement. After the Wall ends, leave the slot blank to share the final Wall. Sign in first.',
        )}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action(async () => {
            const result = await request<{ id: string }>(
              apiOrigin,
              '/me/shares',
              'POST',
              {
                wallId,
                ...(slotId ? { slotId } : {}),
                ...(alias ? { publicAlias: alias, publishAlias: consent } : {}),
              },
            );
            setShareId(result.id);
            setCopied(false);
          });
        }}
      >
        <fieldset disabled={busy}>
          <legend>{t('Public card')}</legend>
          <label>
            {t('Your slot')}
            <select value={slotId} onChange={(e) => setSlotId(e.target.value)}>
              <option value="">{t('Final Wall')}</option>
              {slots.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {t('Slot ')}
                  {slot.position + 1}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('Public username (optional)')}
            <input
              maxLength={40}
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />{' '}
            {t('Publish this username on a public card')}
          </label>
          <button type="submit" disabled={!!alias && !consent}>
            {t('Create share card')}
          </button>
        </fieldset>
      </form>
      {shareId && (
        <div>
          <p>
            <a href={`/s/${shareId}`}>{t('Open share card')}</a>
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                void request(
                  apiOrigin,
                  `/public/shares/${shareId}/interactions`,
                  'POST',
                  { kind: 'share_clicked', dedupeKey: crypto.randomUUID() },
                ).catch(() => {});
                if (navigator.share) {
                  try {
                    await navigator.share({ title: 'Destka', url });
                    return;
                  } catch (e) {
                    if (e instanceof Error && e.name === 'AbortError') return;
                  }
                }
                try {
                  await navigator.clipboard.writeText(url);
                  setCopied(true);
                } catch {
                  setError(`Copy this link: ${url}`);
                }
              })
            }
          >
            {t('Share or copy link')}
          </button>
          {copied && <p role="status">{t('Link copied.')}</p>}
          <p>
            <a href={url}>{url}</a>
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await request(apiOrigin, `/me/shares/${shareId}`, 'DELETE');
                setShareId('');
              })
            }
          >
            {t('Revoke public link')}
          </button>
        </div>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void action(async () => {
            await request(
              apiOrigin,
              `/me/notifications/walls/${wallId}`,
              'PUT',
              { enabled: true },
            );
            setNotice(
              'Wall reminders enabled. Manage channels in Notifications.',
            );
          })
        }
      >
        {t('Notify me before this Wall starts or ends')}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void action(async () => {
            await request(
              apiOrigin,
              `/me/notifications/walls/${wallId}`,
              'PUT',
              { enabled: false },
            );
            setNotice('Unsubscribed from Wall reminders.');
          })
        }
      >
        {t('Unsubscribe from this Wall')}
      </button>
      {error && <p role="alert">{t(error)}</p>}
      {notice && <p role="status">{t(notice)}</p>}
    </section>
  );
}
