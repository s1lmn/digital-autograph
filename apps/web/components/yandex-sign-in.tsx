'use client';

import { useEffect, useState } from 'react';

// Visibility is server-authoritative and fail-closed. There is no public env flag.
export function YandexSignIn({
  apiOrigin,
  returnTo,
}: {
  apiOrigin: string;
  returnTo: string;
}) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    setAvailable(false);
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`${apiOrigin}/auth/providers`, {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data: unknown = await response.json();
        if (
          !controller.signal.aborted &&
          data &&
          typeof data === 'object' &&
          'yandex' in data
        )
          setAvailable(data.yandex === true);
      } catch {
        /* Availability fails closed, including malformed responses. */
      }
    })();
    return () => controller.abort();
  }, [apiOrigin]);
  if (!available) return null;
  return (
    <a
      href={`${apiOrigin}/auth/yandex/start?returnTo=${encodeURIComponent(returnTo)}`}
    >
      Продолжить через Яндекс ID
    </a>
  );
}
