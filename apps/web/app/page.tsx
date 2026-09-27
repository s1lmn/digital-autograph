import { loadWebConfig } from '@digital-autograph/config';
import { liveHealthResponse } from '@digital-autograph/contracts';

export const dynamic = 'force-dynamic';

async function getApiStatus(): Promise<'online' | 'unavailable'> {
  const { API_INTERNAL_URL } = loadWebConfig();
  try {
    const response = await fetch(`${API_INTERNAL_URL}/health/live`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return 'unavailable';
    const body: unknown = await response.json();
    return liveHealthResponse.safeParse(body).success
      ? 'online'
      : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export default async function HomePage() {
  const apiStatus = await getApiStatus();

  return (
    <main>
      <p className="eyebrow">Digital Autograph Platform</p>
      <h1>Project bootstrap</h1>
      <p>The web shell is running. Product screens will arrive in later PRs.</p>
      <p>
        API health: <strong>{apiStatus}</strong>
      </p>
      <p>
        <a href="/autograph/create">Create a digital autograph</a>
      </p>
    </main>
  );
}
