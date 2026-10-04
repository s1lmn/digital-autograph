'use client';

import { useEffect, useState } from 'react';

export function countdownLabel(deadline: string, now: number): string {
  const seconds = Math.max(
    0,
    Math.ceil((new Date(deadline).getTime() - now) / 1000),
  );
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days > 0 ? `${days}d ` : ''}${hours}h ${minutes}m ${seconds % 60}s`;
}

export function WallCountdown({
  startAt,
  endAt,
  status,
}: {
  startAt: string | null;
  endAt: string | null;
  status: string;
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if ((!startAt && !endAt) || status === 'ended' || status === 'paused')
    return null;
  const waiting = startAt && now !== null && new Date(startAt).getTime() > now;
  const deadline = waiting ? startAt : endAt;
  return (
    <p>
      <span
        style={{
          display: 'block',
          minHeight: '3em',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {now === null ? (
          'Loading remaining time…'
        ) : deadline ? (
          <>
            {waiting ? 'Starts in' : 'Ends in'}:{' '}
            <span>{countdownLabel(deadline, now)}</span>
          </>
        ) : (
          'No end time has been set.'
        )}
      </span>
      Times are approximate; availability is checked when you confirm.
    </p>
  );
}
