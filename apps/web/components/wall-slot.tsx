'use client';

import { useState } from 'react';
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
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const number = slot.position + 1;
  const mediaPath = slot.currentPlacement?.mediaPath;
  const showMedia = Boolean(mediaPath && failedPath !== mediaPath);

  return (
    <li className={styles.slot} aria-label={`Slot ${number}`}>
      <span className={styles.slotNumber}>Slot {number}</span>
      {slot.occupied ? (
        <div className={styles.slotContent}>
          {showMedia && mediaPath ? (
            <img
              className={styles.autograph}
              src={`${apiOrigin}${mediaPath}`}
              alt={`Digital autograph in slot ${number}`}
              crossOrigin="anonymous"
              referrerPolicy="no-referrer"
              onError={() => setFailedPath(mediaPath)}
            />
          ) : (
            <p>Autograph unavailable</p>
          )}
        </div>
      ) : (
        <div className={styles.slotContent}>
          <p>Empty slot</p>
          {actionLabel && (
            <button type="button" disabled={actionDisabled} onClick={onAction}>
              {actionLabel}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
