'use client';
import { useEffect } from 'react';
export function ShareReferral({
  shareId,
  apiOrigin,
}: {
  shareId: string;
  apiOrigin: string;
}) {
  useEffect(() => {
    const storageKey = `share-referral-${shareId}`;
    let key: string;
    try {
      key = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
      sessionStorage.setItem(storageKey, key);
    } catch {
      return;
    }
    void fetch(`${apiOrigin}/public/shares/${shareId}/interactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'referral_arrived', dedupeKey: key }),
    }).catch(() => {});
  }, [shareId, apiOrigin]);
  return null;
}
