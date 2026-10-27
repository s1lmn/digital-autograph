'use client';
import { useLocale } from './locale-provider';

import { useEffect, useState } from 'react';
import { autographApi } from '../lib/autograph-api';
import type { ReadyAutographChoice } from '../lib/wall-claim-api';
import styles from '../app/walls/[id]/page.module.css';

type Preview = { url: string; expiresAt: string };

export function ReadyAutographPicker({
  choices,
  selectedId,
  onSelect,
  apiOrigin,
}: {
  choices: ReadyAutographChoice[];
  selectedId: string;
  onSelect: (id: string) => void;
  apiOrigin: string;
}) {
  const { t } = useLocale();

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    autographApi(apiOrigin)
      .preview(selectedId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setPreview({ url: result.url, expiresAt: result.expiresAt });
          setPreviewError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setPreviewError(true);
      });
    return () => controller.abort();
  }, [apiOrigin, selectedId, refresh]);

  useEffect(() => {
    if (!preview || !selectedId) return;
    const delay = Math.max(
      1000,
      new Date(preview.expiresAt).getTime() - Date.now() - 5000,
    );
    const timer = setTimeout(() => setRefresh((count) => count + 1), delay);
    return () => clearTimeout(timer);
  }, [preview, selectedId]);

  return (
    <section className={styles.picker} aria-labelledby="ready-heading">
      <h2 id="ready-heading">{t('Choose your ready autograph')}</h2>
      <div className={styles.choices}>
        {choices.map((choice) => (
          <label key={choice.id} className={styles.choice}>
            <input
              type="radio"
              name="ready-autograph"
              value={choice.id}
              checked={choice.id === selectedId}
              onChange={() => {
                setPreview(null);
                setPreviewError(false);
                onSelect(choice.id);
              }}
            />
            <span>
              {choice.source === 'canvas' ? t('Drawn') : t('Photo')}
              {t(' autograph · moderated')}{' '}
              {new Date(choice.moderatedAt).toISOString().slice(0, 10)}
              {t(' UTC')}
            </span>
          </label>
        ))}
      </div>
      {selectedId && (
        <div className={styles.privatePreview}>
          <p>{t('Your private preview')}</p>
          {preview && !previewError ? (
            <img
              key={`${selectedId}:${preview.url}`}
              src={preview.url}
              alt={t('Private preview of your selected digital autograph')}
              crossOrigin="anonymous"
              referrerPolicy="no-referrer"
              onError={() => setPreviewError(true)}
            />
          ) : (
            <p role="status">
              {previewError
                ? t('Preview unavailable. Refresh it to try again.')
                : t('Loading preview…')}
            </p>
          )}
          <button
            type="button"
            onClick={() => setRefresh((count) => count + 1)}
          >
            {t('Refresh private preview')}
          </button>
        </div>
      )}
    </section>
  );
}
