'use client';
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
  const [slotId, setSlotId] = useState('');
  const [alias, setAlias] = useState('');
  const [consent, setConsent] = useState(false);
  const [shareId, setShareId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  async function action(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
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
      aria-label="Sharing and Wall notifications"
    >
      <h2>Share your place</h2>
      <p>
        Create a card for your own placement. After the Wall ends, leave the
        slot blank to share the final Wall. Sign in first.
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
          <legend>Public card</legend>
          <label>
            Your slot
            <select value={slotId} onChange={(e) => setSlotId(e.target.value)}>
              <option value="">Final Wall</option>
              {slots.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  Slot {slot.position + 1}
                </option>
              ))}
            </select>
          </label>
          <label>
            Public username (optional)
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
            Publish this username on a public card
          </label>
          <button type="submit" disabled={!!alias && !consent}>
            Create share card
          </button>
        </fieldset>
      </form>
      {shareId && (
        <div>
          <p>
            <a href={`/s/${shareId}`}>Open share card</a>
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
                    await navigator.share({ title: 'Digital Autograph', url });
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
            Share or copy link
          </button>
          {copied && <p role="status">Link copied.</p>}
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
            Revoke public link
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
          })
        }
      >
        Notify me before this Wall starts or ends
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
          })
        }
      >
        Unsubscribe from this Wall
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
