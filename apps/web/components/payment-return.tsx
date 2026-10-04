'use client';
import { useCallback, useEffect, useState } from 'react';
const messages: Record<string, string> = {
  created: 'Payment is being prepared.',
  provider_pending: 'Payment is pending.',
  unknown: 'Payment status is being checked. Do not start another payment.',
  canceled: 'Payment was canceled.',
  paid_but_not_fulfilled:
    'Payment received, but placement could not be completed. Manual review is required.',
  fulfilled: 'Your placement is complete.',
};
export function PaymentReturn({
  apiOrigin,
  orderId,
}: {
  apiOrigin: string;
  orderId: string;
}) {
  const [message, setMessage] = useState('Checking payment…');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    if (!/^[0-9a-f-]{36}$/.test(orderId)) {
      setMessage('Invalid order reference.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(
        `${apiOrigin}/payments/orders/${orderId}/refresh`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          cache: 'no-store',
        },
      );
      if (response.status === 401) {
        setMessage('Sign in to view your payment.');
        return;
      }
      if (!response.ok) {
        setMessage('Unable to check this payment. Try refreshing its status.');
        return;
      }
      const result = (await response.json()) as { status: string };
      setMessage(messages[result.status] ?? 'Payment requires review.');
    } catch {
      setMessage(
        'Unable to check payment status. Check your connection and retry.',
      );
    } finally {
      setBusy(false);
    }
  }, [apiOrigin, orderId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <section>
      <p role="status">{message}</p>
      <button type="button" disabled={busy} onClick={() => void refresh()}>
        Refresh payment status
      </button>
      <p>
        <a href="/me/placements">View your placement history</a>
      </p>
    </section>
  );
}
