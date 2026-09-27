import { moderationRejectionReasons } from '@digital-autograph/contracts';

export const rejectionReasons = moderationRejectionReasons;

export type RejectionReason = (typeof rejectionReasons)[number];
export type QueueItem = {
  id: string;
  source: 'canvas' | 'photo';
  approvedAt: string;
  createdAt: string;
};
export type QueuePage = { items: QueueItem[]; nextCursor: string | null };
export type PrivatePreview = { url: string; expiresAt: string };
export type ModerationDecision =
  | { decision: 'approved' }
  | { decision: 'rejected'; reasonCode: RejectionReason };

export class ModerationApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function request<T>(
  origin: string,
  path: string,
  signal: AbortSignal,
  body?: ModerationDecision,
): Promise<T> {
  const response = await fetch(`${origin}${path}`, {
    method: body ? 'POST' : 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      json &&
      typeof json === 'object' &&
      'error' in json &&
      json.error &&
      typeof json.error === 'object' &&
      'code' in json.error &&
      typeof json.error.code === 'string'
        ? json.error.code
        : 'REQUEST_FAILED';
    throw new ModerationApiError(response.status, error);
  }
  return json as T;
}

export function moderationApi(origin: string) {
  return {
    queue: (limit: number, cursor: string | null, signal: AbortSignal) => {
      const query = new URLSearchParams({ limit: String(limit) });
      if (cursor) query.set('cursor', cursor);
      return request<QueuePage>(
        origin,
        `/moderation/autographs?${query}`,
        signal,
      );
    },
    preview: (id: string, signal: AbortSignal) =>
      request<PrivatePreview>(
        origin,
        `/moderation/autographs/${encodeURIComponent(id)}/preview`,
        signal,
      ),
    decide: (id: string, body: ModerationDecision, signal: AbortSignal) =>
      request<{
        id: string;
        status: 'ready' | 'moderation_rejected';
        decision: 'approved' | 'rejected';
        reasonCode: RejectionReason | null;
        decidedAt: string;
      }>(
        origin,
        `/moderation/autographs/${encodeURIComponent(id)}/decision`,
        signal,
        body,
      ),
  };
}
