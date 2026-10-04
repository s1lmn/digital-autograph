'use client';

export default function PageError({ reset }: { reset: () => void }) {
  return (
    <main>
      <h1>Page temporarily unavailable</h1>
      <p role="alert">Check your connection and try again.</p>
      <button type="button" onClick={reset}>
        Retry
      </button>
      <p>
        <a href="/">Return home</a>
      </p>
    </main>
  );
}
