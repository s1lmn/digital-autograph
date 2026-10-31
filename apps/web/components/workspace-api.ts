export type Workspace = {
  profile: { id: string; slug: string; displayName: string } | null;
  autographs: {
    id: string;
    source: string;
    status: string;
    createdAt: string;
  }[];
  walls: { id: string; status: string; slotCount: number; createdAt: string }[];
  canModerate: boolean;
};
export async function workspaceRequest<T>(
  origin: string,
  path: string,
  signal: AbortSignal,
  body?: unknown,
  method = 'POST',
): Promise<T> {
  const response = await fetch(origin + path, {
    credentials: 'include',
    cache: 'no-store',
    signal,
    method: body === undefined ? 'GET' : method,
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw Error(
      response.status === 401
        ? 'SIGN_IN'
        : (result?.error?.code ?? 'REQUEST_FAILED'),
    );
  return result as T;
}
