'use client';
import { useLocale } from './locale-provider';

import { useEffect, useRef, useState } from 'react';
import {
  checkoutSummarySchema,
  checkoutQuerySchema,
} from '@digital-autograph/contracts';
import type {
  CheckoutSummary,
  CheckoutConfirmation,
} from '@digital-autograph/domain';
import { FirstUseActionNotice } from './first-use-action-notice';
import { autographApi } from '../lib/autograph-api';
import styles from './paid-checkout.module.css';
const documents = {
  public_offer: { title: 'Публичная оферта', slug: 'offer' },
  community_guidelines: {
    title: 'Правила размещения контента',
    slug: 'content-rules',
  },
  refund_policy: { title: 'Политика возвратов', slug: 'refunds' },
};
export const checkoutMessages: Record<string, string> = {
  LEGAL_DOCUMENT_UNAVAILABLE:
    'Документы временно недоступны. Новые заказы пока не создаются.',
  CHECKOUT_TERMS_CHANGED:
    'Условия заказа изменились. Ознакомьтесь с обновлёнными условиями и подтвердите их заново.',
  RESERVATION_EXPIRED:
    'Срок бронирования истёк. Получите новые условия на стенде; прежняя цена не гарантируется.',
  RESERVATION_NOT_ELIGIBLE:
    'Место больше недоступно по этим условиям. Вернитесь на стенд.',
  NEW_PAYMENTS_DISABLED: 'Платежи временно приостановлены.',
  RESERVATION_NOT_FOUND:
    'Бронирование недоступно. Проверьте аккаунт и вернитесь на стенд.',
  ORDER_REQUEST_CONFLICT:
    'Заказ уже связан с другим автографом. Не создавайте повторный платёж.',
};
function safeProviderUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048 || /[\\\s]/.test(value))
    return null;
  try {
    const u = new URL(value);
    return u.origin === 'https://yoomoney.ru' &&
      !u.username &&
      !u.password &&
      !u.hash
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function PaidCheckout({
  apiOrigin,
  reservationId,
  autographId,
}: {
  apiOrigin: string;
  reservationId: string;
  autographId: string;
}) {
  const { t, locale } = useLocale();

  const [summary, setSummary] = useState<CheckoutSummary | null>(null);
  const [preview, setPreview] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [legalRequired, setLegalRequired] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [retry, setRetry] = useState(0);
  const [orderStatus, setOrderStatus] = useState('created');
  const [orderId, setOrderId] = useState('');
  const [providerUrl, setProviderUrl] = useState('');
  const pending = useRef(false);
  const attempted = useRef<CheckoutConfirmation | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const c = new AbortController();
    attempted.current = null;
    setLegalRequired(false);
    setAnonymous(false);
    setChecked(false);
    setSummary(null);
    setPreview('');
    setLoaded(false);
    setProviderUrl('');
    setOrderId('');
    async function read() {
      if (
        !checkoutQuerySchema.safeParse({ reservationId, autographId }).success
      )
        throw new Error('RESERVATION_NOT_FOUND');
      const r = await fetch(
        `${apiOrigin}/payments/checkout?${new URLSearchParams({ reservationId, autographId })}`,
        { credentials: 'include', cache: 'no-store', signal: c.signal },
      );
      if (r.status === 401) {
        setAnonymous(true);
        return;
      }
      const value = await r.json();
      if (!r.ok)
        throw new Error(value.error?.code ?? 'LEGAL_DOCUMENT_UNAVAILABLE');
      if (
        typeof value.existingOrderId === 'string' &&
        /^[a-f0-9-]{36}$/.test(value.existingOrderId)
      ) {
        const status = await fetch(
          `${apiOrigin}/payments/orders/${value.existingOrderId}`,
          { credentials: 'include', cache: 'no-store', signal: c.signal },
        );
        if (!status.ok) throw new Error('unknown');
        const order = await status.json();
        setOrderStatus(order.status);
        setProviderUrl(
          order.status === 'provider_pending'
            ? (safeProviderUrl(order.confirmationUrl) ?? '')
            : '',
        );
        setOrderId(value.existingOrderId);
        return;
      }
      const s = checkoutSummarySchema.parse(value);
      // Check the published API bytes too: unavailable/tampered/placeholder documents never enable submission.
      for (const d of s.documents) {
        const response = await fetch(
          `${apiOrigin}/legal/documents/${d.type}/${d.version}`,
          {
            credentials: 'omit',
            cache: 'no-store',
            redirect: 'error',
            signal: c.signal,
          },
        );
        if (
          !response.ok ||
          response.headers.get('x-legal-document-status') !== 'published' ||
          !response.headers.get('content-type')?.startsWith('text/plain')
        )
          throw new Error('LEGAL_DOCUMENT_UNAVAILABLE');
        const bytes = await response.arrayBuffer();
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        const hash = Array.from(
          new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
        )
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        if (text.includes('[[') || hash !== d.hash)
          throw new Error('LEGAL_DOCUMENT_UNAVAILABLE');
      }
      const a = await autographApi(apiOrigin).preview(autographId, c.signal);
      if (!c.signal.aborted) {
        setSummary(s);
        setPreview(a.url);
        setError('');
      }
    }
    read().catch((e) => {
      if (!c.signal.aborted) {
        const code = e instanceof Error ? e.message : '';
        setLegalRequired(code === 'FIRST_USE_REQUIRED');
        setError(
          checkoutMessages[code] ??
            'Не удалось проверить условия заказа. Проверьте соединение и повторите проверку.',
        );
      }
    });
    return () => c.abort();
  }, [apiOrigin, reservationId, autographId, retry]);
  useEffect(() => {
    if (error) heading.current?.focus();
  }, [error]);
  async function submit() {
    if (pending.current || !summary || !checked || !loaded) return;
    pending.current = true;
    setBusy(true);
    setError('');
    const confirmation: CheckoutConfirmation = attempted.current ?? {
      confirmed: true,
      documents: summary.documents,
      terms: {
        amountMinor: summary.amountMinor,
        currency: summary.currency,
        guaranteedVisibilitySeconds: summary.guaranteedVisibilitySeconds,
        reservationExpiresAt: summary.reservationExpiresAt,
        targetPlacementId: summary.targetPlacementId,
        pricingConfigId: summary.pricingConfigId,
      },
    };
    attempted.current = confirmation;
    try {
      const r = await fetch(`${apiOrigin}/payments/orders`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reservationId, autographId, confirmation }),
      });
      const value = await r.json();
      if (!r.ok) {
        const code = value.error?.code;
        if (
          [
            'CHECKOUT_TERMS_CHANGED',
            'LEGAL_DOCUMENT_UNAVAILABLE',
            'NEW_PAYMENTS_DISABLED',
            'RESERVATION_EXPIRED',
            'RESERVATION_NOT_ELIGIBLE',
            'FIRST_USE_REQUIRED',
          ].includes(code)
        ) {
          attempted.current = null;
          setChecked(false);
          setSummary(null);
          setLegalRequired(code === 'FIRST_USE_REQUIRED');
        }
        throw new Error(code);
      }
      if (typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id))
        throw new Error('unknown');
      setOrderStatus(value.status);
      setOrderId(value.id);
      setProviderUrl(safeProviderUrl(value.confirmationUrl) ?? '');
      setChecked(false);
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      setError(
        checkoutMessages[code] ??
          'Состояние заказа уточняется. Повторите тот же запрос или проверку; не создавайте другое бронирование и не оплачивайте повторно.',
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const returnTo = `/payments/checkout?${new URLSearchParams({ reservationId, autographId })}`;
  return (
    <section
      className={styles.checkout}
      aria-labelledby="checkout-heading"
      aria-busy={busy}
    >
      <p className="eyebrow">{t('Destka')}</p>
      <h2 id="checkout-heading" ref={heading} tabIndex={-1}>
        {t('Условия вашего заказа')}
      </h2>
      {anonymous ? (
        <>
          <p>{t('Войдите, чтобы проверить собственное бронирование.')}</p>
          <a
            href={`${apiOrigin}/auth/google/start?${new URLSearchParams({ returnTo })}`}
          >
            {t('Войти через Google')}
          </a>
        </>
      ) : null}
      {error && <p role="alert">{t(error)}</p>}
      {legalRequired && <FirstUseActionNotice returnTo={returnTo} />}
      {orderId ? (
        <>
          <p role="status">
            {t(
              (
                {
                  created: 'Состояние заказа уточняется.',
                  provider_pending: 'Заказ создан. Оплата ожидается.',
                  unknown:
                    'Состояние заказа уточняется. Не оплачивайте повторно.',
                  succeeded: 'Оплата подтверждена.',
                  fulfilled: 'Оплата подтверждена. Размещение выполнено.',
                  paid_but_not_fulfilled:
                    'Оплата получена, но размещение пока не выполнено. Требуется проверка и возврат по применимым условиям.',
                  canceled: 'Платёж отменён.',
                } as Record<string, string>
              )[orderStatus] ?? 'Состояние заказа уточняется.',
            )}{' '}
            {t('Переход к провайдеру не подтверждает оплату или размещение.')}
          </p>
          {providerUrl && (
            <a className={styles.pay} href={providerUrl} rel="noreferrer">
              {t('Перейти к оплате в ЮKassa')}
            </a>
          )}
          <p>
            <a href={`/payments/return?orderId=${orderId}`}>
              {t('Проверить состояние заказа')}
            </a>
          </p>
        </>
      ) : summary ? (
        <>
          <dl>
            <dt>{t('Стенд')}</dt>
            <dd>
              <a href={`/walls/${summary.wallId}`}>{summary.wallTitle}</a>
            </dd>
            <dt>{t('Создатель')}</dt>
            <dd>{summary.creatorName}</dd>
            <dt>{t('Ячейка')}</dt>
            <dd>№ {summary.slotNumber}</dd>
            <dt>{t('Полная стоимость')}</dt>
            <dd>
              {new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
                style: 'currency',
                currency: 'RUB',
              }).format(Number(summary.amountMinor) / 100)}
            </dd>
            <dt>{t('Гарантированный период видимости после замещения')}</dt>
            <dd>
              {summary.guaranteedVisibilitySeconds}
              {t(' секунд')}
            </dd>
            <dt>{t('Бронирование действует до')}</dt>
            <dd>
              <time dateTime={summary.reservationExpiresAt}>
                {new Date(summary.reservationExpiresAt).toLocaleString(
                  locale === 'ru' ? 'ru-RU' : 'en-US',
                )}
              </time>
            </dd>
          </dl>
          <figure>
            <img
              src={preview}
              alt={t('Одобренный автограф для выбранного размещения')}
              referrerPolicy="no-referrer"
              onLoad={() => setLoaded(true)}
              onError={() => {
                setLoaded(false);
                setError('Не удалось показать автограф. Повторите проверку.');
              }}
            />
            <figcaption>
              {t('Будет размещён только этот одобренный автограф.')}
            </figcaption>
          </figure>
          <p>
            {t(
              'После подтверждённой оплаты в пределах бронирования этот автограф заменит текущее размещение в выбранной ячейке. Гарантированный период начинается с успешного замещения.',
            )}
          </p>
          <p>
            {t(
              'После гарантированного периода размещение может быть замещено. Ячейка не становится вашей собственностью; бессрочная видимость не гарантируется.',
            )}
          </p>
          <ul className={styles.docs}>
            {summary.documents.map((d) => (
              <li key={d.type}>
                <a
                  target="_blank"
                  rel="noopener noreferrer"
                  href={`/legal/${documents[d.type].slug}/versions/${d.version}`}
                >
                  {t(documents[d.type].title)}
                  {t(' — редакция ')}
                  {d.version}
                  {t(' (новая вкладка)')}
                </a>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <fieldset disabled={busy}>
              <legend>{t('Подтверждение платных условий')}</legend>
              <label>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                />
                {t(
                  'Я ознакомился с Публичной офертой, Правилами размещения контента и Политикой возвратов и подтверждаю указанные условия этого заказа.',
                )}
              </label>
            </fieldset>
            <button type="submit" disabled={!checked || !loaded || busy}>
              {busy
                ? t('Проверяем заказ…')
                : t('Подтвердить заказ и перейти к оплате')}
            </button>
          </form>
          <p>
            {t(
              'Платёжные реквизиты вводятся только на защищённой странице ЮKassa. Destka не запрашивает номер карты, CVV/CVC, банковские пароли или SMS-коды.',
            )}
          </p>
          <p>
            {t(
              'Это подтверждение не является согласием на обработку или распространение персональных данных и не заменяет декларацию 18+ и Пользовательское соглашение.',
            )}
          </p>
        </>
      ) : !error && !anonymous ? (
        <p role="status">{t('Проверяем условия…')}</p>
      ) : null}
      {!anonymous && (
        <button
          disabled={busy}
          type="button"
          onClick={() => {
            setError('');
            setRetry((n) => n + 1);
          }}
        >
          {t('Повторить проверку условий')}
        </button>
      )}
      <p>
        <a href="/legal">{t('Опубликованные документы')}</a> ·{' '}
        <a href="/me">{t('Аккаунт и выход')}</a>
      </p>
    </section>
  );
}
