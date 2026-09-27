export type AutographStatus =
  | 'draft'
  | 'upload_pending'
  | 'uploaded_unverified'
  | 'processing'
  | 'awaiting_approval'
  | 'processing_failed';

export type Autograph = {
  id: string;
  source: 'canvas' | 'photo';
  status: AutographStatus;
};

export class AutographApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

async function apiJson<T>(
  origin: string,
  path: string,
  signal: AbortSignal,
  body?: object,
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
    const code = errorCode(json) ?? 'REQUEST_FAILED';
    throw new AutographApiError(code, response.status);
  }
  return json as T;
}

function errorCode(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('error' in value)) return null;
  const error = value.error;
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}

export function autographApi(origin: string) {
  return {
    create: (signal: AbortSignal) =>
      apiJson<Autograph>(origin, '/autographs', signal, { source: 'canvas' }),
    get: (id: string, signal: AbortSignal) =>
      apiJson<Autograph>(
        origin,
        `/autographs/${encodeURIComponent(id)}`,
        signal,
      ),
    initiateUpload: (id: string, sizeBytes: number, signal: AbortSignal) =>
      apiJson<{
        method: 'PUT';
        url: string;
        headers: Record<string, string>;
        expiresAt: string;
      }>(origin, `/autographs/${encodeURIComponent(id)}/upload`, signal, {
        contentType: 'image/png',
        sizeBytes,
      }),
    upload: async (
      signed: { method: 'PUT'; url: string; headers: Record<string, string> },
      png: Blob,
      signal: AbortSignal,
    ) => {
      const response = await fetch(signed.url, {
        method: signed.method,
        headers: signed.headers,
        body: png,
        credentials: 'omit',
        signal,
      });
      if (!response.ok)
        throw new AutographApiError('UPLOAD_FAILED', response.status);
    },
    complete: (id: string, signal: AbortSignal) =>
      apiJson<Autograph>(
        origin,
        `/autographs/${encodeURIComponent(id)}/upload/complete`,
        signal,
        {},
      ),
    preview: (id: string, signal: AbortSignal) =>
      apiJson<{ url: string; expiresAt: string }>(
        origin,
        `/autographs/${encodeURIComponent(id)}/preview`,
        signal,
      ),
  };
}
