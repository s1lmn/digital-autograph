'use client';
import { useLocale } from './locale-provider';

import { YandexSignIn } from './yandex-sign-in';
import { VkIdSignIn } from './vk-id-sign-in';

import { useEffect, useRef, useState } from 'react';
import {
  ModerationApiError,
  moderationApi,
  rejectionReasons,
  type QueueItem,
  type PrivatePreview,
  type RejectionReason,
} from '../lib/moderation-api';
import styles from './moderation-workspace.module.css';

const reasonLabels: Record<RejectionReason, string> = {
  SEXUAL_CONTENT: 'Explicit sexual content',
  HATE_OR_EXTREMISM: 'Hate or extremist content',
  THREATS_OR_VIOLENCE: 'Threats or graphic violence',
  PERSONAL_DATA: 'Sensitive personal data',
  IMPERSONATION_OR_DECEPTIVE: 'Deceptive impersonation',
  ILLEGAL_OR_PROHIBITED: 'Illegal or prohibited content',
  NOT_AN_AUTOGRAPH: 'Not an autograph',
  OTHER_POLICY_VIOLATION: 'Other policy violation',
};

export function ModerationWorkspace({ apiOrigin }: { apiOrigin: string }) {
  const { t, locale } = useLocale();

  const api = useRef(moderationApi(apiOrigin));
  const [access, setAccess] = useState<
    'loading' | 'allowed' | 'signin' | 'forbidden' | 'error'
  >('loading');
  const [items, setItems] = useState<QueueItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<PrivatePreview | null>(null);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [reason, setReason] = useState<RejectionReason | ''>('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const deciding = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const previewController = useRef<AbortController | null>(null);

  useEffect(() => {
    const next = new AbortController();
    controller.current = next;
    api.current
      .queue(20, null, next.signal)
      .then((page) => {
        if (next.signal.aborted) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setAccess('allowed');
      })
      .catch((error: unknown) => {
        if (next.signal.aborted) return;
        if (error instanceof ModerationApiError && error.status === 401)
          setAccess('signin');
        else if (error instanceof ModerationApiError && error.status === 403)
          setAccess('forbidden');
        else setAccess('error');
      });
    return () => {
      controller.current?.abort();
      previewController.current?.abort();
    };
  }, [apiOrigin]);

  useEffect(() => {
    if (!preview) return;
    const delay = Math.min(
      2_147_483_647,
      Math.max(0, new Date(preview.expiresAt).getTime() - Date.now()),
    );
    const timer = window.setTimeout(() => {
      setPreviewLoaded(false);
      setPreviewError(
        'The private preview expired. Refresh it before deciding.',
      );
    }, delay);
    return () => window.clearTimeout(timer);
  }, [preview]);

  const loadPreview = async (id: string) => {
    previewController.current?.abort();
    const next = new AbortController();
    previewController.current = next;
    setSelected(id);
    setPreview(null);
    setPreviewLoaded(false);
    setPreviewError(null);
    setReason('');
    try {
      const value = await api.current.preview(id, next.signal);
      if (!next.signal.aborted) setPreview(value);
    } catch (error) {
      if (!next.signal.aborted) {
        if (error instanceof ModerationApiError && error.status === 403)
          setAccess('forbidden');
        else setPreviewError('Private preview unavailable. Retry.');
      }
    }
  };

  const loadMore = async () => {
    if (!cursor || busy) return;
    const next = new AbortController();
    controller.current = next;
    setBusy(true);
    try {
      const page = await api.current.queue(20, cursor, next.signal);
      if (!next.signal.aborted) {
        setItems((current) => [...current, ...page.items]);
        setCursor(page.nextCursor);
      }
    } catch (error) {
      if (!next.signal.aborted) {
        if (error instanceof ModerationApiError && error.status === 403)
          setAccess('forbidden');
        else setMessage('Could not load more submissions. Retry.');
      }
    } finally {
      setBusy(false);
    }
  };

  const decide = async (decision: 'approved' | 'rejected') => {
    if (
      !selected ||
      !previewLoaded ||
      !preview ||
      Date.now() >= new Date(preview.expiresAt).getTime() ||
      deciding.current ||
      (decision === 'rejected' && !reason)
    )
      return;
    deciding.current = true;
    setBusy(true);
    setMessage(null);
    const next = new AbortController();
    controller.current = next;
    try {
      await api.current.decide(
        selected,
        decision === 'approved'
          ? { decision }
          : { decision, reasonCode: reason as RejectionReason },
        next.signal,
      );
      if (next.signal.aborted) return;
      setItems((current) => current.filter((item) => item.id !== selected));
      setSelected(null);
      setPreview(null);
      setPreviewLoaded(false);
      setMessage(
        decision === 'approved'
          ? 'Approved. The autograph is ready but remains private.'
          : 'Rejected. The owner can see the reason code.',
      );
    } catch (error) {
      if (!next.signal.aborted) {
        if (error instanceof ModerationApiError && error.status === 403) {
          setAccess('forbidden');
          return;
        }
        setMessage(
          error instanceof ModerationApiError &&
            error.code === 'MODERATION_ALREADY_DECIDED'
            ? 'Another moderator already made a different decision. Refresh the queue.'
            : 'Decision could not be confirmed. Retry safely.',
        );
      }
    } finally {
      deciding.current = false;
      setBusy(false);
    }
  };

  if (access === 'loading')
    return <p role="status">{t('Checking moderation access…')}</p>;
  if (access === 'forbidden')
    return (
      <p role="alert">
        {t('Forbidden: a platform moderator or admin role is required.')}
      </p>
    );
  if (access === 'error')
    return (
      <p role="alert">
        {t('Moderation is temporarily unavailable. Refresh the page.')}
      </p>
    );
  if (access === 'signin') {
    const returnTo = encodeURIComponent('/moderation');
    return (
      <section>
        <p>{t('Sign in with a platform moderator account.')}</p>
        <a href={`${apiOrigin}/auth/google/start?returnTo=${returnTo}`}>
          {t('Sign in with Google')}
        </a>
        {' · '}
        <a href={`${apiOrigin}/auth/telegram/start?returnTo=${returnTo}`}>
          {t('Sign in with Telegram')}
        </a>
        <YandexSignIn apiOrigin={apiOrigin} returnTo="/moderation" />
        <VkIdSignIn apiOrigin={apiOrigin} returnTo="/moderation" />
      </section>
    );
  }

  return (
    <div className={styles.layout}>
      <section className={styles.queue} aria-label={t('Pending autographs')}>
        <h2>{t('Pending')}</h2>
        {items.length === 0 && <p>{t('No submissions in this page.')}</p>}
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void loadPreview(item.id)}
              >
                {t(item.source)} ·{' '}
                {new Date(item.approvedAt).toLocaleString(
                  locale === 'ru' ? 'ru-RU' : 'en-US',
                )}
              </button>
            </li>
          ))}
        </ul>
        {cursor && (
          <button type="button" disabled={busy} onClick={() => void loadMore()}>
            {t('Load more')}
          </button>
        )}
      </section>
      <section
        className={styles.review}
        aria-label={t('Review selected autograph')}
      >
        {message && <p role="status">{t(message)}</p>}
        {!selected && <p>{t('Select a pending autograph to review.')}</p>}
        {selected && (
          <>
            <h2>{t('Cleaned autograph')}</h2>
            <p>
              {t(
                'Review this owner-approved image for content suitability only. This is not identity or signature verification.',
              )}
            </p>
            {preview && (
              <img
                key={preview.url}
                src={preview.url}
                alt={t('Private cleaned autograph for moderation')}
                referrerPolicy="no-referrer"
                onLoad={() => {
                  if (Date.now() < new Date(preview.expiresAt).getTime())
                    setPreviewLoaded(true);
                }}
                onError={() => {
                  setPreviewLoaded(false);
                  setPreviewError('Preview could not be loaded. Refresh it.');
                }}
              />
            )}
            {previewError && (
              <p className={styles.error} role="alert">
                {t(previewError)}
              </p>
            )}
            <div className={styles.actions}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void loadPreview(selected)}
              >
                {t('Refresh private preview')}
              </button>
              <button
                type="button"
                disabled={busy || !previewLoaded}
                onClick={() => void decide('approved')}
              >
                {t('Approve')}
              </button>
              <label>
                {t('Rejection reason')}{' '}
                <select
                  aria-label={t('Rejection reason')}
                  disabled={busy}
                  value={reason}
                  onChange={(event) =>
                    setReason(event.target.value as RejectionReason | '')
                  }
                >
                  <option value="">{t('Choose a reason')}</option>
                  {rejectionReasons.map((code) => (
                    <option key={code} value={code}>
                      {t(reasonLabels[code])}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={busy || !previewLoaded || !reason}
                onClick={() => void decide('rejected')}
              >
                {t('Reject')}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
