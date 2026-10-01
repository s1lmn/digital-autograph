export type AutographStatus =
  | 'draft'
  | 'upload_pending'
  | 'uploaded_unverified'
  | 'processing'
  | 'awaiting_approval'
  | 'awaiting_moderation'
  | 'processing_failed';

export type Autograph = {
  id: string;
  source: 'canvas' | 'photo';
  status: AutographStatus;
  approvedAt?: string | null;
};

export type OriginalContentType = 'image/png' | 'image/jpeg';

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
    create: (source: Autograph['source'], signal: AbortSignal) =>
      apiJson<Autograph>(origin, '/autographs', signal, { source }),
    get: (id: string, signal: AbortSignal) =>
      apiJson<Autograph>(
        origin,
        `/autographs/${encodeURIComponent(id)}`,
        signal,
      ),
    initiateUpload: (
      id: string,
      sizeBytes: number,
      contentType: OriginalContentType,
      signal: AbortSignal,
    ) =>
      apiJson<{
        method: 'PUT';
        url: string;
        headers: Record<string, string>;
        expiresAt: string;
      }>(origin, `/autographs/${encodeURIComponent(id)}/upload`, signal, {
        contentType,
        sizeBytes,
      }),
    upload: async (
      signed: { method: 'PUT'; url: string; headers: Record<string, string> },
      image: Blob,
      signal: AbortSignal,
      onProgress?: (progress: number) => void,
    ) => {
      if (onProgress) {
        await new Promise<void>((resolve, reject) => {
          const request = new XMLHttpRequest();
          const abort = () => request.abort();
          request.open(signed.method, signed.url);
          request.withCredentials = false;
          for (const [name, value] of Object.entries(signed.headers)) {
            request.setRequestHeader(name, value);
          }
          request.upload.onprogress = (event) => {
            if (event.lengthComputable && event.total > 0) {
              onProgress(Math.min(1, event.loaded / event.total));
            }
          };
          request.onload = () => {
            signal.removeEventListener('abort', abort);
            if (request.status >= 200 && request.status < 300) resolve();
            else reject(new AutographApiError('UPLOAD_FAILED', request.status));
          };
          request.onerror = () => {
            signal.removeEventListener('abort', abort);
            reject(new AutographApiError('UPLOAD_FAILED', request.status));
          };
          request.onabort = () => {
            signal.removeEventListener('abort', abort);
            reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
          };
          if (signal.aborted) {
            request.abort();
            return;
          }
          signal.addEventListener('abort', abort, { once: true });
          try {
            request.send(image);
          } catch (error) {
            signal.removeEventListener('abort', abort);
            reject(error);
          }
        });
        return;
      }
      const response = await fetch(signed.url, {
        method: signed.method,
        headers: signed.headers,
        body: image,
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
      apiJson<{ assetId: string; url: string; expiresAt: string }>(
        origin,
        `/autographs/${encodeURIComponent(id)}/preview`,
        signal,
      ),
    approve: (id: string, reviewedAssetId: string, signal: AbortSignal) =>
      apiJson<{
        id: string;
        status: 'awaiting_moderation';
        approvedAt: string;
      }>(origin, `/autographs/${encodeURIComponent(id)}/approve`, signal, {
        reviewedAssetId,
      }),
  };
}
