export async function notificationRequest<T>(
  origin: string,
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${origin}${path}`, {
    method,
    credentials: 'include',
    cache: 'no-store',
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new NotificationApiError(response.status);
  return (response.status === 204 ? undefined : await response.json()) as T;
}
export class NotificationApiError extends Error {
  constructor(readonly status: number) {
    super(
      status === 401
        ? 'Sign in to manage notifications.'
        : `Request failed (${status}). Please retry.`,
    );
  }
}
