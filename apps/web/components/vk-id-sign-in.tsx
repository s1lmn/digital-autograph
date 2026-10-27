'use client';
import { useLocale } from './locale-provider';

import { useEffect, useState } from 'react';

// Visibility is server-authoritative and fail-closed. There is no public env flag.
export function VkIdSignIn({
  apiOrigin,
  returnTo,
}: {
  apiOrigin: string;
  returnTo: string;
}) {
  const { t } = useLocale();

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
          'vk_id' in data
        )
          setAvailable(data.vk_id === true);
      } catch {
        /* Availability fails closed, including malformed responses. */
      }
    })();
    return () => controller.abort();
  }, [apiOrigin]);
  if (!available) return null;
  return (
    <a
      href={`${apiOrigin}/auth/vk-id/start?returnTo=${encodeURIComponent(returnTo)}`}
    >
      {t('Продолжить через VK ID')}
    </a>
  );
}
