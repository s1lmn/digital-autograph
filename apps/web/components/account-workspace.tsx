'use client';
import { useEffect, useRef, useState } from 'react';
import { useLocale } from './locale-provider';
import { AccountSession } from './account-session';
import { ThemeSwitcher } from './theme-switcher';
import { LanguageSwitcher } from './language-switcher';
import { workspaceRequest, type Workspace } from './workspace-api';
import { autographApi } from '../lib/autograph-api';
import { CleanedAutographReview } from './cleaned-autograph-review';
import styles from './workspace.module.css';
type Section = 'overview' | 'autographs' | 'walls' | 'settings';
const statuses: Record<string, string> = {
  draft: 'Draft',
  upload_pending: 'Waiting for upload',
  uploaded_unverified: 'Verifying upload',
  processing: 'Processing',
  awaiting_approval: 'Review your preview',
  awaiting_moderation: 'Awaiting moderation',
  approved: 'Approved',
  rejected: 'Rejected',
  processing_failed: 'Processing failed',
  live: 'Live',
  paused: 'Paused',
  scheduled: 'Scheduled',
  ended: 'Ended',
  archived: 'Archived',
};
export function AccountWorkspace({
  apiOrigin,
  section = 'overview',
}: {
  apiOrigin: string;
  section?: Section;
}) {
  const { t, locale } = useLocale();
  const [data, setData] = useState<Workspace | null>(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const busy = useRef(false);
  const mutation = useRef<AbortController | null>(null);
  const [preview, setPreview] = useState<{
    id: string;
    status: string;
    assetId: string;
    url: string;
    expiresAt: string;
  } | null>(null);
  useEffect(() => () => mutation.current?.abort(), []);
  useEffect(() => {
    const c = new AbortController();
    workspaceRequest<Workspace>(apiOrigin, '/me/workspace', c.signal)
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setError(
            e.message === 'SIGN_IN'
              ? 'SIGN_IN'
              : 'Could not load your account. Please retry.',
          );
      });
    return () => c.abort();
  }, [apiOrigin, version]);
  const act = async (
    work: (signal: AbortSignal) => Promise<unknown>,
    notify = true,
  ) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    setSaved(false);
    const c = new AbortController();
    mutation.current = c;
    try {
      await work(c.signal);
      if (!c.signal.aborted) {
        setVersion((v) => v + 1);
        window.dispatchEvent(new Event('destka-workspace-updated'));
        if (notify) setSaved(true);
      }
    } catch (e) {
      if (!c.signal.aborted)
        setError(
          e instanceof Error && e.message === 'SLUG_TAKEN'
            ? 'This username is already taken.'
            : 'Could not save changes. Refresh before retrying.',
        );
    } finally {
      busy.current = false;
      if (!c.signal.aborted) setPending(false);
    }
  };
  const preferences =
    section === 'settings' ? (
      <section className={styles.card}>
        <h2>{t('Appearance and language')}</h2>
        <div className={styles.actions}>
          <ThemeSwitcher />
          <LanguageSwitcher />
        </div>
      </section>
    ) : null;
  if (error === 'SIGN_IN')
    return (
      <div className={styles.workspace}>
        {preferences}
        <AccountSession
          apiOrigin={apiOrigin}
          onSignedOut={() => window.location.assign('/me')}
        />
      </div>
    );
  if (!data)
    return (
      <section>
        {preferences}
        <p role={error ? 'alert' : 'status'}>
          {t(error || 'Loading your space…')}
        </p>
        {error && (
          <button onClick={() => setVersion((v) => v + 1)}>{t('Retry')}</button>
        )}
      </section>
    );
  const profile = data.profile;
  const date = (s: string) =>
    new Date(s).toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-GB');
  return (
    <div className={styles.workspace}>
      <nav className={styles.tabs} aria-label={t('Account sections')}>
        {(
          [
            ['overview', '/me', 'Overview'],
            ['autographs', '/me/autographs', 'My autographs'],
            ['walls', '/me/walls', 'My Walls'],
            ['settings', '/me/settings', 'Settings'],
          ] as const
        ).map(([key, url, label]) => (
          <a
            key={key}
            href={url}
            aria-current={section === key ? 'page' : undefined}
          >
            {t(label)}
          </a>
        ))}
      </nav>
      {error && <p role="alert">{t(error)}</p>}
      {saved && <p role="status">{t('Changes saved.')}</p>}
      {section === 'overview' && (
        <>
          <div className={styles.actions}>
            <span className={styles.avatar} aria-hidden="true">
              {Array.from(profile?.displayName ?? '')[0]?.toUpperCase() ?? 'D'}
            </span>
            <div>
              <h2>{profile?.displayName ?? t('Your space')}</h2>
              <p className={styles.muted}>
                {profile
                  ? '@' + profile.slug
                  : t('Choose a name in settings to create your first Wall.')}
              </p>
            </div>
          </div>
          <div className={styles.grid}>
            <section className={styles.card}>
              <h2>{t('My autographs')}</h2>
              <p>
                {t('Your drawings, private previews and moderation status.')}
              </p>
              <a href="/me/autographs">{t('Open my autographs')} →</a>
            </section>
            <section className={styles.card}>
              <h2>{t('My Walls')}</h2>
              <p>{t('Create a Wall and invite people to leave their mark.')}</p>
              <a href="/me/walls">{t('Open my Walls')} →</a>
            </section>
          </div>
        </>
      )}
      {section === 'autographs' && (
        <>
          <p>
            {t(
              'Original uploads stay private. Only you can review these previews.',
            )}
          </p>
          <a className={styles.primary} href="/autograph/create">
            {t('Create autograph')}
          </a>
          {data.autographs.length === 0 ? (
            <p>{t('No autographs yet. Start with a drawing or a photo.')}</p>
          ) : (
            <div className={styles.grid}>
              {data.autographs.map((a) => (
                <article className={styles.card} key={a.id}>
                  <h2>{t(a.source === 'canvas' ? 'Drawing' : 'Photo')}</h2>
                  <p>{date(a.createdAt)}</p>
                  <p>{t(statuses[a.status] ?? a.status)}</p>
                  {[
                    'awaiting_approval',
                    'awaiting_moderation',
                    'approved',
                    'rejected',
                  ].includes(a.status) && (
                    <button
                      disabled={pending}
                      onClick={() =>
                        void act(async (signal) => {
                          const p = await autographApi(apiOrigin).preview(
                            a.id,
                            signal,
                          );
                          setPreview({ id: a.id, status: a.status, ...p });
                        }, false)
                      }
                    >
                      {t('Open private preview')}
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
          {preview && (
            <section className={styles.card}>
              <button onClick={() => setPreview(null)}>
                {t('Close preview')}
              </button>
              {preview.status === 'awaiting_approval' ? (
                <CleanedAutographReview
                  key={preview.id}
                  autographId={preview.id}
                  api={autographApi(apiOrigin)}
                  initialPreview={preview}
                  onStartOver={() => setPreview(null)}
                />
              ) : (
                <img
                  src={preview.url}
                  alt={t('Your private cleaned autograph')}
                  referrerPolicy="no-referrer"
                  onError={() => {
                    setPreview(null);
                    setError('Preview expired. Open it again.');
                  }}
                />
              )}
            </section>
          )}
          <p className={styles.muted}>
            {t(
              'Showing up to 50 recent autographs. Refresh to update processing status.',
            )}
          </p>
          <button onClick={() => setVersion((v) => v + 1)}>
            {t('Refresh')}
          </button>
        </>
      )}
      {section === 'walls' && (
        <>
          {!profile ? (
            <section className={styles.card}>
              <h2>{t('Give your Wall a name')}</h2>
              <p>
                {t(
                  'Set up your public creator profile first. Your original uploads will remain private.',
                )}
              </p>
              <a href="/me/settings">{t('Set up profile')} →</a>
            </section>
          ) : (
            <>
              <p>
                {t(
                  'A new Wall starts as a private draft. Publish it only when you are ready.',
                )}
              </p>
              <form
                className={styles.form}
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  void act((signal) =>
                    workspaceRequest(
                      apiOrigin,
                      `/creators/${profile.id}/walls`,
                      signal,
                      { slotCount: Number(form.get('slots')) },
                    ),
                  );
                }}
              >
                <label>
                  {t('Number of places')}
                  <input
                    name="slots"
                    type="number"
                    min={1}
                    max={1000}
                    defaultValue={24}
                    required
                  />
                </label>
                <button disabled={pending}>
                  {pending ? t('Saving…') : t('Create draft Wall')}
                </button>
              </form>
            </>
          )}
          {data.walls.length === 0 ? (
            <p>{t('Your Walls will appear here.')}</p>
          ) : (
            <div className={styles.grid}>
              {data.walls.map((w, i) => (
                <article className={styles.card} key={w.id}>
                  <h2>
                    {t('Wall')} {data.walls.length - i}
                  </h2>
                  <p>
                    {t(statuses[w.status] ?? w.status)} ·{' '}
                    {t('Places: {count}', { count: w.slotCount })}
                  </p>
                  <p>{date(w.createdAt)}</p>
                  <div className={styles.actions}>
                    {w.status !== 'draft' && (
                      <a href={`/walls/${w.id}`}>{t('Open Wall')}</a>
                    )}
                    {w.status === 'draft' && (
                      <button
                        disabled={pending}
                        onClick={() =>
                          void act((signal) =>
                            workspaceRequest(
                              apiOrigin,
                              `/walls/${w.id}/transitions`,
                              signal,
                              { action: 'publish' },
                            ),
                          )
                        }
                      >
                        {t('Publish Wall')}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
          <p className={styles.muted}>{t('Showing up to 50 recent Walls.')}</p>
        </>
      )}
      {section === 'settings' && (
        <>
          <section className={styles.card}>
            <h2>{t('Public profile')}</h2>
            <p>
              {t(
                'Your name and username appear on your creator page. Your sign-in details stay private.',
              )}
            </p>
            <form
              key={profile?.slug ?? 'new'}
              className={styles.form}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void act((signal) =>
                  workspaceRequest(
                    apiOrigin,
                    '/me/profile',
                    signal,
                    { displayName: f.get('displayName'), slug: f.get('slug') },
                    'PUT',
                  ),
                );
              }}
            >
              <label>
                {t('Display name')}
                <input
                  name="displayName"
                  disabled={pending}
                  maxLength={80}
                  defaultValue={profile?.displayName ?? ''}
                  required
                  autoComplete="nickname"
                />
              </label>
              <label>
                {t('Username')}
                <input
                  name="slug"
                  disabled={pending}
                  minLength={3}
                  maxLength={64}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  defaultValue={profile?.slug ?? ''}
                  required
                  aria-describedby="username-help"
                />
              </label>
              <p id="username-help">
                {t(
                  'Use lowercase Latin letters, numbers and hyphens. Changing this changes your public profile link.',
                )}
              </p>
              <button disabled={pending}>
                {pending ? t('Saving…') : t('Save profile')}
              </button>
              {profile && (
                <a href={`/creators/${profile.slug}`}>
                  {t('Open public profile')}
                </a>
              )}
            </form>
          </section>
          {preferences}
          <section className={styles.card}>
            <h2>{t('Session')}</h2>
            <AccountSession
              apiOrigin={apiOrigin}
              onSignedOut={() => window.location.assign('/me')}
            />
          </section>
        </>
      )}
    </div>
  );
}
