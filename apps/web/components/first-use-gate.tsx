'use client';
import { useLocale } from './locale-provider';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  firstUseStateSchema,
  type FirstUseState,
} from '@digital-autograph/contracts';
import styles from './first-use-gate.module.css';

const title = {
  terms_of_use: 'Пользовательское соглашение',
  community_guidelines: 'Правила размещения контента',
};
const slug = { terms_of_use: 'terms', community_guidelines: 'content-rules' };
export function FirstUseGate({
  apiOrigin,
  children,
  onReady,
  loginReturnTo = '/legal/first-use',
}: {
  apiOrigin: string;
  children: ReactNode;
  onReady?: () => void;
  loginReturnTo?: string;
}) {
  const { t } = useLocale();

  const [state, setState] = useState<FirstUseState | null>(null);
  const [error, setError] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [retry, setRetry] = useState(0);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function read(signal?: AbortSignal) {
    const response = await fetch(`${apiOrigin}/legal/first-use`, {
      credentials: 'include',
      cache: 'no-store',
      signal,
    });
    if (response.status === 401) {
      setAnonymous(true);
      return null;
    }
    if (!response.ok) throw new Error('unavailable');
    return firstUseStateSchema.parse(await response.json());
  }
  useEffect(() => {
    const c = new AbortController();
    read(c.signal)
      .then((s) => {
        if (!c.signal.aborted) setState(s);
      })
      .catch(() => {
        if (!c.signal.aborted)
          setError(
            'Не удалось проверить подтверждения. Проверьте соединение и повторите попытку.',
          );
      });
    return () => c.abort();
    // Each mount/retry reads the server. No persisted client authorization.
  }, [apiOrigin, retry]);
  useEffect(() => {
    if (!state?.complete) heading.current?.focus();
  }, [state, error, anonymous]);
  const submit = async () => {
    if (pending.current || !state?.available) return;
    pending.current = true;
    setBusy(true);
    setError('');
    const c = new AbortController();
    request.current = c;
    try {
      const post = async (path: string, body: unknown) => {
        const r = await fetch(`${apiOrigin}${path}`, {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: c.signal,
        });
        if (!r.ok) {
          const code = (await r.json()).error?.code;
          throw new Error(
            code === 'LEGAL_DOCUMENT_CHANGED' ? 'changed' : 'unavailable',
          );
        }
      };
      if (!state.adultDeclared) {
        if (!checks.adult) return;
        await post('/legal/first-use/age', { adultDeclared: true });
      }
      for (const d of state.documents)
        if (!d.accepted) {
          if (!checks[d.type]) return;
          await post('/legal/accept', {
            type: d.type,
            version: d.version,
            hash: d.hash,
          });
        }
      const fresh = await read(c.signal);
      if (!c.signal.aborted) {
        setState(fresh);
        setChecks({});
      }
    } catch (e) {
      if (!c.signal.aborted) {
        setChecks({});
        setState(null);
        setError(
          e instanceof Error && e.message === 'changed'
            ? 'Редакция документа изменилась. Ознакомьтесь с новой редакцией и подтвердите её заново.'
            : 'Подтверждение не завершено. Проверьте соединение и повторите попытку.',
        );
        setRetry((n) => n + 1);
      }
    } finally {
      pending.current = false;
      if (!c.signal.aborted) setBusy(false);
    }
  };
  useEffect(() => {
    if (state?.enforced === false || state?.complete) onReady?.();
  }, [state?.enforced, state?.complete, onReady]);
  if (state?.enforced === false || state?.complete) return children;
  const allowed =
    !!state?.available &&
    (state.adultDeclared || checks.adult) &&
    state.documents.every((d) => d.accepted || checks[d.type]);
  return (
    <section
      className={styles.gate}
      aria-labelledby="first-use-heading"
      aria-busy={busy}
    >
      <p className="eyebrow">{t('Destka')}</p>
      <h2 id="first-use-heading" ref={heading} tabIndex={-1}>
        {t('Перед первым действием')}
      </h2>
      <p>
        {t(
          'Для создания автографа и размещения на Wall подтвердите возраст и ознакомьтесь с условиями сервиса. Вход через Google или Telegram не означает принятия условий.',
        )}
      </p>
      <p>
        {t(
          'Автограф — декоративный контент, а не юридическая подпись. Не загружайте банковскую, официальную или другую чувствительную подпись.',
        )}
      </p>
      {error && <p role="alert">{t(error)}</p>}
      {anonymous ? (
        <div className={styles.actions}>
          <p>{t('Войдите, чтобы подтвердить условия.')}</p>
          <a
            href={`${apiOrigin}/auth/google/start?returnTo=${encodeURIComponent(loginReturnTo)}`}
          >
            {t('Войти через Google')}
          </a>
          <a
            href={`${apiOrigin}/auth/telegram/start?returnTo=${encodeURIComponent(loginReturnTo)}`}
          >
            {t('Войти через Telegram')}
          </a>
        </div>
      ) : !state ? (
        <>
          <p role="status">
            {error ? t('Проверка недоступна.') : t('Проверяем подтверждения…')}
          </p>
          {error && (
            <button
              onClick={() => {
                setError('');
                setRetry((n) => n + 1);
              }}
            >
              {t('Повторить проверку')}
            </button>
          )}
        </>
      ) : !state.available ? (
        <p role="status">
          {t(
            'Интерактивные функции пока недоступны: действующие документы ещё не опубликованы. Подтверждение сейчас не требуется.',
          )}
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset disabled={busy}>
            <legend>{t('Отдельные подтверждения')}</legend>
            {state.adultDeclared ? (
              <p>{t('Декларация 18+ уже сохранена.')}</p>
            ) : (
              <label>
                <input
                  type="checkbox"
                  checked={!!checks.adult}
                  onChange={(e) =>
                    setChecks((c) => ({ ...c, adult: e.target.checked }))
                  }
                />
                {t('Мне исполнилось 18 лет.')}
              </label>
            )}
            {state.documents.map((d) => (
              <div key={`${d.type}:${d.version}:${d.hash}`}>
                <a
                  href={`/legal/${slug[d.type]}/versions/${d.version}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t(title[d.type])}
                  {t(' — редакция ')}
                  {d.version}
                  {t(' (откроется в новой вкладке)')}
                </a>
                {d.accepted ? (
                  <p>{t('Эта редакция уже принята.')}</p>
                ) : (
                  <label>
                    <input
                      type="checkbox"
                      checked={!!checks[d.type]}
                      onChange={(e) =>
                        setChecks((c) => ({ ...c, [d.type]: e.target.checked }))
                      }
                    />
                    {d.type === 'terms_of_use'
                      ? t('Принимаю Пользовательское соглашение.')
                      : t('Принимаю Правила размещения контента.')}
                  </label>
                )}
              </div>
            ))}
          </fieldset>
          <button type="submit" disabled={!allowed || busy}>
            {busy ? t('Сохраняем подтверждения…') : t('Продолжить')}
          </button>
        </form>
      )}
      <div className={styles.actions}>
        <a href="/legal">{t('Опубликованные документы')}</a>
        <a href="/me">{t('Аккаунт и выход')}</a>
      </div>
      <p className={styles.note}>
        {t(
          'Подтверждения не разрешают публикацию профиля и не являются согласием на дополнительные цели обработки данных. Вы можете отказаться и выйти из аккаунта. Законные обращения по персональным данным остаются доступны независимо от принятия условий.',
        )}
      </p>
    </section>
  );
}
