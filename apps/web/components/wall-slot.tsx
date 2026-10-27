'use client';
import { useLocale } from './locale-provider';

import { useState } from 'react';
import { frontendCapabilities } from '../lib/frontend-capabilities';
import { placementSourceLabel } from '../lib/placement-history-api';
import type { PublicWall } from '../lib/public-wall-api';
import styles from '../app/walls/[id]/page.module.css';

type Slot = PublicWall['slots'][number];

export function WallSlot({
  slot,
  apiOrigin,
  actionLabel,
  actionDisabled = false,
  onAction,
}: {
  slot: Slot;
  apiOrigin: string;
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
}) {
  const { t } = useLocale();

  const [failedPath, setFailedPath] = useState<string | null>(null);
  const number = slot.position + 1;
  const mediaPath = slot.currentPlacement?.mediaPath;
  const showMedia = Boolean(mediaPath && failedPath !== mediaPath);

  return (
    <li
      id={`slot-${slot.id}`}
      tabIndex={-1}
      className={styles.slot}
      aria-label={t(`Slot ${number}`)}
    >
      <span className={styles.slotNumber}>
        {t('Slot ')}
        {number}
      </span>
      {slot.occupied ? (
        <div className={styles.slotContent}>
          {showMedia && mediaPath ? (
            <img
              className={styles.autograph}
              src={`${apiOrigin}${mediaPath}`}
              alt={t(`Digital autograph in slot ${number}`)}
              crossOrigin="anonymous"
              referrerPolicy="no-referrer"
              onError={() => setFailedPath(mediaPath)}
            />
          ) : (
            <div>
              <p>{t('Autograph unavailable')}</p>
              {mediaPath && (
                <button type="button" onClick={() => setFailedPath(null)}>
                  {t('Retry autograph')}
                </button>
              )}
            </div>
          )}
          <p>
            {t('Current placement')}
            {slot.currentPlacement
              ? ` · ${t(placementSourceLabel(slot.currentPlacement.source))}`
              : ''}
          </p>
          {!frontendCapabilities.paidTakeover && (
            <div>
              <button
                type="button"
                disabled
                aria-describedby={`takeover-unavailable-${slot.id}`}
              >
                {t('Paid takeover')}
              </button>
              <p id={`takeover-unavailable-${slot.id}`}>
                {t('Paid takeover is not available yet.')}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className={styles.slotContent}>
          <span className={styles.emptyMark} aria-hidden="true">
            +
          </span>
          <p>{t('Empty slot')}</p>
          {actionLabel && (
            <button
              id={`slot-action-${slot.id}`}
              type="button"
              disabled={actionDisabled}
              onClick={onAction}
            >
              {t(actionLabel)}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
