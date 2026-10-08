'use client';

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
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const number = slot.position + 1;
  const mediaPath = slot.currentPlacement?.mediaPath;
  const showMedia = Boolean(mediaPath && failedPath !== mediaPath);

  return (
    <li
      id={`slot-${slot.id}`}
      tabIndex={-1}
      className={styles.slot}
      aria-label={`Slot ${number}`}
    >
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
            <div>
              <p>Autograph unavailable</p>
              {mediaPath && (
                <button type="button" onClick={() => setFailedPath(null)}>
                  Retry autograph
                </button>
              )}
            </div>
          )}
          <p>
            Current placement
            {slot.currentPlacement
              ? ` · ${placementSourceLabel(slot.currentPlacement.source)}`
              : ''}
          </p>
          {!frontendCapabilities.paidTakeover && (
            <div>
              <button
                type="button"
                disabled
                aria-describedby={`takeover-unavailable-${slot.id}`}
              >
                Paid takeover
              </button>
              <p id={`takeover-unavailable-${slot.id}`}>
                Paid takeover is not available yet.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className={styles.slotContent}>
          <p>Empty slot</p>
          {actionLabel && (
            <button
              id={`slot-action-${slot.id}`}
              type="button"
              disabled={actionDisabled}
              onClick={onAction}
            >
              {actionLabel}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
