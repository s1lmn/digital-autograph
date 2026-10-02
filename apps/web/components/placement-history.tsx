'use client';

import { useEffect, useState } from 'react';
import {
  PlacementHistoryApiError,
  placementEndReasonLabel,
  placementHistoryApi,
  placementSourceLabel,
  type PlacementHistoryItem,
} from '../lib/placement-history-api';
import styles from './placement-history.module.css';

function HistoryTime({ value }: { value: string }) {
  return (
    <time dateTime={value}>
      {new Date(value).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      })}{' '}
      UTC
    </time>
  );
}

export function WallPlacementHistory({
  wallId,
  apiOrigin,
  refreshVersion = 0,
}: {
  refreshVersion?: number;
  wallId: string;
  apiOrigin: string;
}) {
  const [items, setItems] = useState<Array<
    Pick<
      PlacementHistoryItem,
      'slotPosition' | 'source' | 'startedAt' | 'endedAt' | 'endReason'
    >
  > | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    placementHistoryApi(apiOrigin)
      .wall(wallId, controller.signal)
      .then((history) => {
        if (!controller.signal.aborted) {
          setItems(history.placements);
          setError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [apiOrigin, wallId, refreshVersion, retry]);

  return (
    <section
      className={styles.history}
      aria-labelledby="wall-history-heading"
      aria-busy={loading}
    >
      <h2 id="wall-history-heading">Placement history</h2>
      {loading && <p role="status">Loading Wall history…</p>}
      {error && (
        <div>
          <p role="alert">Wall placement history is temporarily unavailable.</p>
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setError(false);
              setRetry((count) => count + 1);
            }}
          >
            Retry Wall history
          </button>
        </div>
      )}
      {items?.length === 0 && <p>No placements have been recorded yet.</p>}
      {items && items.length >= 100 && (
        <p>Showing the 100 most recent placements.</p>
      )}
      {items && items.length > 0 && (
        <ol className={styles.historyList}>
          {items.map((item) => (
            <li
              key={`${item.slotPosition}:${item.startedAt}`}
              className={styles.item}
            >
              <h3>Slot {item.slotPosition + 1}</h3>
              <p>{placementSourceLabel(item.source)}</p>
              <p>
                Started: <HistoryTime value={item.startedAt} />
              </p>
              {item.endedAt ? (
                <p>
                  Ended: <HistoryTime value={item.endedAt} />
                </p>
              ) : (
                <p>Current placement</p>
              )}
              {item.endReason && (
                <p>{placementEndReasonLabel(item.endReason)}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function UserPlacementHistory({ apiOrigin }: { apiOrigin: string }) {
  const [auth, setAuth] = useState<
    'checking' | 'authenticated' | 'anonymous' | 'unavailable'
  >('checking');
  const [items, setItems] = useState<PlacementHistoryItem[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const api = placementHistoryApi(apiOrigin);
    api
      .session(controller.signal)
      .then(async (state) => {
        if (controller.signal.aborted) return;
        setAuth(state);
        if (state === 'authenticated') {
          const history = await api.mine(controller.signal);
          if (!controller.signal.aborted) setItems(history);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setItems(null);
          if (
            error instanceof PlacementHistoryApiError &&
            error.status === 401
          ) {
            setAuth('anonymous');
            setError(false);
          } else {
            setAuth('unavailable');
            setError(true);
          }
        }
      });
    return () => controller.abort();
  }, [apiOrigin, retry]);

  if (auth === 'checking') {
    return <p role="status">Checking sign-in…</p>;
  }
  if (auth === 'anonymous') {
    const returnTo = encodeURIComponent('/me/placements');
    return (
      <section className={styles.history}>
        <p>Sign in to view your placement history.</p>
        <p className={styles.actions}>
          <a href={`${apiOrigin}/auth/google/start?returnTo=${returnTo}`}>
            Continue with Google
          </a>
          <a href={`${apiOrigin}/auth/telegram/start?returnTo=${returnTo}`}>
            Continue with Telegram
          </a>
        </p>
      </section>
    );
  }
  if (error) {
    return (
      <section>
        <p role="alert">Your placement history is temporarily unavailable.</p>
        <button
          type="button"
          onClick={() => {
            setAuth('checking');
            setItems(null);
            setError(false);
            setRetry((count) => count + 1);
          }}
        >
          Retry your history
        </button>
      </section>
    );
  }
  if (items === null) {
    return <p role="status">Loading your placement history…</p>;
  }
  if (!items.length) {
    return <p>You have no Wall placements yet.</p>;
  }
  return (
    <>
      {items.length >= 100 && <p>Showing your 100 most recent placements.</p>}
      <ol className={styles.historyList}>
        {items.map((item) => (
          <li
            key={`${item.wallId}:${item.slotPosition}:${item.startedAt}`}
            className={styles.item}
          >
            <h2>
              {item.wallIsPublic ? (
                <a href={`/walls/${item.wallId}`}>
                  {item.wallDisplayName}&apos;s Wall
                </a>
              ) : (
                <>{item.wallDisplayName}&apos;s Wall</>
              )}
            </h2>
            <p>Slot {item.slotPosition + 1}</p>
            <p>{placementSourceLabel(item.source)}</p>
            <p>
              Started: <HistoryTime value={item.startedAt} />
            </p>
            {item.endedAt ? (
              <p>
                Ended: <HistoryTime value={item.endedAt} />
              </p>
            ) : (
              <p>Current placement</p>
            )}
            {item.endReason && <p>{placementEndReasonLabel(item.endReason)}</p>}
          </li>
        ))}
      </ol>
    </>
  );
}
