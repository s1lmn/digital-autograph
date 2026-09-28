'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PublicWallApiError,
  publicWallApi,
  type PublicWall,
} from '../lib/public-wall-api';
import {
  WallClaimApiError,
  wallClaimApi,
  type ReadyAutographChoice,
} from '../lib/wall-claim-api';
import { ReadyAutographPicker } from './ready-autograph-picker';
import { WallSlot } from './wall-slot';
import styles from '../app/walls/[id]/page.module.css';

type AuthState = 'checking' | 'anonymous' | 'authenticated' | 'unavailable';
type ClaimPhase = 'idle' | 'claiming' | 'success' | 'conflict' | 'error';

function potentiallyClaimable(wall: PublicWall, now: number): boolean {
  return (
    wall.status === 'live' &&
    (wall.startAt === null || new Date(wall.startAt).getTime() <= now) &&
    (wall.endAt === null || new Date(wall.endAt).getTime() > now)
  );
}

function wallNotice(wall: PublicWall, now: number) {
  if (wall.status === 'scheduled') return 'Claims have not started yet.';
  if (wall.status === 'paused')
    return 'This Wall is paused. Existing autographs remain visible.';
  if (wall.status === 'ended')
    return 'This Wall has ended. Existing autographs remain visible.';
  if (wall.startAt && new Date(wall.startAt).getTime() > now)
    return 'Claims have not started yet.';
  if (wall.endAt && new Date(wall.endAt).getTime() <= now)
    return 'Claims have ended.';
  return 'Empty slots may be claimed once the server confirms availability.';
}

export function PublicWallScreen({
  initialWall,
  apiOrigin,
}: {
  initialWall: PublicWall;
  apiOrigin: string;
}) {
  const [wall, setWall] = useState(initialWall);
  const [now, setNow] = useState(() => Date.now());
  const [auth, setAuth] = useState<AuthState>('checking');
  const [ready, setReady] = useState<ReadyAutographChoice[] | null>(null);
  const [readyError, setReadyError] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [targetSlotId, setTargetSlotId] = useState<string | null>(null);
  const [claimUsed, setClaimUsed] = useState(false);
  const [claimsUnavailable, setClaimsUnavailable] = useState(false);
  const [phase, setPhase] = useState<ClaimPhase>('idle');
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const inFlight = useRef(false);
  const requestController = useRef<AbortController | null>(null);

  const loadReady = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const items = await wallClaimApi(apiOrigin).readyAutographs(signal);
        if (signal?.aborted) return;
        setReady(items);
        setReadyError(false);
        setSelectedId((current) =>
          items.some((item) => item.id === current)
            ? current
            : (items[0]?.id ?? ''),
        );
      } catch {
        if (!signal?.aborted) setReadyError(true);
      }
    },
    [apiOrigin],
  );

  useEffect(() => {
    const controller = new AbortController();
    wallClaimApi(apiOrigin)
      .session(controller.signal)
      .then(async (state) => {
        if (controller.signal.aborted) return;
        setAuth(state);
        if (state === 'authenticated') await loadReady(controller.signal);
      })
      .catch(() => {
        if (!controller.signal.aborted) setAuth('unavailable');
      });
    return () => controller.abort();
  }, [apiOrigin, loadReady]);

  useEffect(() => () => requestController.current?.abort(), []);

  const refreshWall = useCallback(async () => {
    setRefreshing(true);
    setRefreshError(false);
    try {
      const updated = await publicWallApi(apiOrigin).get(wall.id);
      setWall(updated);
      setNow(Date.now());
      return true;
    } catch (error) {
      setRefreshError(true);
      if (error instanceof PublicWallApiError && error.status === 404)
        setClaimsUnavailable(true);
      return false;
    } finally {
      setRefreshing(false);
    }
  }, [apiOrigin, wall.id]);

  const claim = async () => {
    if (inFlight.current || !targetSlotId || !selectedId || claimUsed) return;
    inFlight.current = true;
    const controller = new AbortController();
    requestController.current = controller;
    setPhase('claiming');
    setMessage('Claiming this slot…');
    try {
      await wallClaimApi(apiOrigin).claim(
        wall.id,
        targetSlotId,
        selectedId,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setClaimUsed(true);
      setTargetSlotId(null);
      setPhase('success');
      setMessage('Your autograph is on the Wall.');
      await refreshWall();
    } catch (error) {
      if (controller.signal.aborted) return;
      setPhase('conflict');
      if (error instanceof WallClaimApiError) {
        if (error.code === 'SLOT_OCCUPIED') {
          setMessage(
            'Someone claimed this slot first. The Wall has been refreshed.',
          );
          setTargetSlotId(null);
          await refreshWall();
        } else if (error.code === 'FREE_CLAIM_ALREADY_USED') {
          setClaimUsed(true);
          setTargetSlotId(null);
          setMessage('Your one free claim on this Wall has already been used.');
        } else if (error.code === 'WALL_NOT_CLAIMABLE') {
          setClaimsUnavailable(true);
          setTargetSlotId(null);
          setMessage('This Wall is no longer available for free claims.');
          await refreshWall();
        } else if (
          error.code === 'AUTOGRAPH_NOT_READY' ||
          error.code === 'AUTOGRAPH_EVIDENCE_INCONSISTENT'
        ) {
          setTargetSlotId(null);
          setMessage(
            'That autograph is no longer ready. Choose another ready autograph.',
          );
          await loadReady(controller.signal);
        } else if (error.status === 401) {
          setAuth('anonymous');
          setMessage('Your session expired. Sign in to continue.');
        } else {
          setPhase('error');
          setMessage(
            'Could not confirm the claim. Retry the same request safely.',
          );
        }
      } else {
        setPhase('error');
        setMessage(
          'Could not confirm the claim. Retry the same request safely.',
        );
      }
    } finally {
      inFlight.current = false;
      if (requestController.current === controller)
        requestController.current = null;
    }
  };

  const canClaim =
    potentiallyClaimable(wall, now) && !claimsUnavailable && !claimUsed;
  const selected = ready?.find((item) => item.id === selectedId);
  const target = wall.slots.find((slot) => slot.id === targetSlotId);
  const returnTo = encodeURIComponent(`/walls/${wall.id}`);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className="eyebrow">Digital Autograph Platform</p>
        <h1>{wall.creator.displayName}&apos;s Wall</h1>
        <p className={styles.state}>
          Wall status: <strong>{wall.status}</strong>
        </p>
        <p>{wallNotice(wall, now)}</p>
        {wall.startAt && <p>Starts: {new Date(wall.startAt).toUTCString()}</p>}
        {wall.endAt && <p>Ends: {new Date(wall.endAt).toUTCString()}</p>}
        <button
          type="button"
          onClick={() => void refreshWall()}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing…' : 'Refresh Wall'}
        </button>
        {refreshError && (
          <p role="alert">The Wall could not be refreshed. Try again.</p>
        )}
      </header>

      <section aria-labelledby="slots-heading">
        <h2 id="slots-heading">Slots</h2>
        <ol className={styles.grid}>
          {wall.slots.map((slot) => {
            const actionLabel =
              !canClaim || slot.occupied
                ? undefined
                : auth === 'anonymous'
                  ? 'Sign in to claim'
                  : auth === 'authenticated' && ready?.length
                    ? 'Claim this slot'
                    : undefined;
            return (
              <WallSlot
                key={slot.id}
                slot={slot}
                apiOrigin={apiOrigin}
                actionLabel={actionLabel}
                actionDisabled={phase === 'claiming'}
                onAction={() => {
                  setTargetSlotId(slot.id);
                  setPhase('idle');
                  setMessage('');
                }}
              />
            );
          })}
        </ol>
      </section>

      {canClaim && auth === 'checking' && (
        <p role="status">Checking sign-in…</p>
      )}
      {canClaim && auth === 'unavailable' && (
        <p role="alert">Sign-in is temporarily unavailable.</p>
      )}
      {canClaim &&
        auth === 'authenticated' &&
        ready === null &&
        !readyError && <p role="status">Loading your ready autographs…</p>}
      {canClaim && auth === 'authenticated' && readyError && (
        <p role="alert">
          Your ready autographs could not be loaded. Refresh this page.
        </p>
      )}
      {canClaim && auth === 'authenticated' && ready?.length === 0 && (
        <section className={styles.panel}>
          <h2>Create an autograph first</h2>
          <p>You need a moderated, ready digital autograph to claim a Slot.</p>
          <a href="/autograph/create">Create your digital autograph</a>
        </section>
      )}
      {canClaim && auth === 'authenticated' && ready && ready.length > 0 && (
        <ReadyAutographPicker
          choices={ready}
          selectedId={selectedId}
          onSelect={setSelectedId}
          apiOrigin={apiOrigin}
        />
      )}

      {canClaim && target && !target.occupied && auth === 'anonymous' && (
        <section className={styles.panel} aria-labelledby="sign-in-heading">
          <h2 id="sign-in-heading">
            Sign in to claim Slot {target.position + 1}
          </h2>
          <div className={styles.actions}>
            <a href={`${apiOrigin}/auth/google/start?returnTo=${returnTo}`}>
              Continue with Google
            </a>
            <a href={`${apiOrigin}/auth/telegram/start?returnTo=${returnTo}`}>
              Continue with Telegram
            </a>
          </div>
        </section>
      )}

      {canClaim &&
        target &&
        !target.occupied &&
        auth === 'authenticated' &&
        selected && (
          <section className={styles.panel} aria-labelledby="confirm-heading">
            <h2 id="confirm-heading">Confirm your free claim</h2>
            <p>Wall: {wall.creator.displayName}</p>
            <p>Slot: {target.position + 1}</p>
            <p>
              Autograph: {selected.source === 'canvas' ? 'Drawn' : 'Photo'}{' '}
              autograph
            </p>
            <p>
              You can use the free claim once on this Wall. If your autograph is
              later displaced, the free claim is not restored.
            </p>
            <div className={styles.actions}>
              <button
                type="button"
                onClick={() => void claim()}
                disabled={phase === 'claiming'}
              >
                {phase === 'claiming'
                  ? 'Claiming…'
                  : phase === 'error'
                    ? 'Retry same claim'
                    : 'Confirm free claim'}
              </button>
              <button
                type="button"
                onClick={() => setTargetSlotId(null)}
                disabled={phase === 'claiming'}
              >
                Cancel
              </button>
            </div>
          </section>
        )}

      {message && (
        <p
          role={phase === 'conflict' || phase === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          className={styles.message}
        >
          {message}
        </p>
      )}
    </main>
  );
}
