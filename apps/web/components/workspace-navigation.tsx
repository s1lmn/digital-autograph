'use client';
import { useEffect, useState, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { BrandMark, Icon } from './ui-icon';
import { useLocale } from './locale-provider';
import { workspaceRequest, type Workspace } from './workspace-api';
import styles from './workspace.module.css';
export function WorkspaceNavigation({ apiOrigin }: { apiOrigin: string }) {
  const { t } = useLocale();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((v) => v + 1);
    window.addEventListener('destka-workspace-updated', refresh);
    return () =>
      window.removeEventListener('destka-workspace-updated', refresh);
  }, []);
  const [account, setAccount] = useState<Workspace | null>(null);
  const header = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const c = new AbortController();
    workspaceRequest<Workspace>(apiOrigin, '/me/workspace', c.signal)
      .then(setAccount)
      .catch(() => {});
    return () => c.abort();
  }, [apiOrigin, path, revision]);
  useEffect(() => {
    setOpen(false);
  }, [path]);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !header.current?.contains(event.target)
      )
        setOpen(false);
    };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('keydown', close);
      window.removeEventListener('pointerdown', outside);
    };
  }, [open]);
  const links = [
    ['/me', t('Overview'), 'user'],
    ['/me/autographs', t('My autographs'), 'pen'],
    ['/me/walls', t('My Walls'), 'globe'],
    ['/me/placements', t('Placement history'), 'history'],
    ['/me/notifications', t('Notifications'), 'bell'],
    ...(account?.canModerate
      ? [['/moderation', t('Moderation'), 'check']]
      : []),
    ['/me/settings', t('Settings'), 'theme'],
  ];
  return (
    <header ref={header} className={styles.header}>
      <a className="brand" href="/" aria-label="Destka">
        <BrandMark />
        <span>Destka.</span>
      </a>
      <button
        ref={toggle}
        type="button"
        aria-expanded={open}
        aria-controls="workspace-menu"
        onClick={() => setOpen(!open)}
      >
        {open ? t('Close menu') : t('Menu')}
      </button>
      <a className={styles.accountLink} href="/me">
        <span className={styles.avatar} aria-hidden="true">
          {Array.from(
            account?.profile?.displayName ?? '',
          )[0]?.toUpperCase() ?? <Icon name="user" />}
        </span>
        <span>{account?.profile?.displayName ?? t('Your account')}</span>
      </a>
      {open && (
        <nav
          id="workspace-menu"
          aria-label={t('Main navigation')}
          className={styles.menu}
        >
          <p>{t('Your space')}</p>
          {links.map(([href, label, icon]) => (
            <a
              key={href}
              href={href}
              target={
                path === '/autograph/create' && href === '/me/settings'
                  ? '_blank'
                  : undefined
              }
              rel={
                path === '/autograph/create' && href === '/me/settings'
                  ? 'noopener noreferrer'
                  : undefined
              }
              aria-label={
                path === '/autograph/create' && href === '/me/settings'
                  ? t('Settings (opens in a new tab)')
                  : undefined
              }
              aria-current={path === href ? 'page' : undefined}
            >
              <Icon name={icon as Parameters<typeof Icon>[0]['name']} />
              {label}
            </a>
          ))}
          <a
            className={styles.primary}
            href={account ? '/autograph/create' : '/me'}
          >
            {account ? t('Create autograph') : t('Sign in to continue')}
          </a>
        </nav>
      )}
    </header>
  );
}
