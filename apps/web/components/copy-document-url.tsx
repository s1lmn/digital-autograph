'use client';
import { useState } from 'react';

export function CopyDocumentUrl({ path }: { path: string }) {
  const [status, setStatus] = useState('');
  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(
              new URL(path, window.location.origin).href,
            );
            setStatus('Ссылка скопирована.');
          } catch {
            setStatus('Не удалось скопировать. Скопируйте адрес ссылки ниже.');
          }
        }}
      >
        Копировать ссылку на редакцию
      </button>
      <p aria-live="polite">{status}</p>
      <a href={path}>Постоянная ссылка на эту редакцию</a>
    </div>
  );
}
