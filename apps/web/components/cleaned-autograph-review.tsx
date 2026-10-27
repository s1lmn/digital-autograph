'use client';
import { useLocale } from './locale-provider';

import { useEffect, useRef, useState } from 'react';
import { AutographApiError } from '../lib/autograph-api';
import {
  FirstUseActionNotice,
  needsFirstUseConfirmation,
} from './first-use-action-notice';
import styles from './canvas-create-screen.module.css';

type Preview = { assetId: string; url: string; expiresAt: string };
type ReviewApi = {
  approve(
    id: string,
    reviewedAssetId: string,
    signal: AbortSignal,
  ): Promise<{
    status: 'awaiting_moderation';
    approvedAt: string;
  }>;
  preview(id: string, signal: AbortSignal): Promise<Preview>;
};

type ApprovalState =
  | { kind: 'preview' }
  | { kind: 'approving' }
  | { kind: 'approval_error'; message: string; legalRequired?: boolean }
  | { kind: 'submitted_for_moderation'; approvedAt: string };

function approvalError(error: unknown): string {
  if (error instanceof AutographApiError) {
    if (error.code === 'REVIEWED_ASSET_MISMATCH') {
      return 'The cleaned version changed. Refresh the preview before approving.';
    }
    if (error.status === 401)
      return 'Your session expired. Sign in again to retry.';
  }
  return 'Approval could not be confirmed. Retry safely; this will not create a duplicate approval.';
}

export function CleanedAutographReview({
  api,
  autographId,
  initialPreview,
  onStartOver,
}: {
  api: ReviewApi;
  autographId: string;
  initialPreview: Preview;
  onStartOver: () => void;
}) {
  const { t } = useLocale();

  const [preview, setPreview] = useState(initialPreview);
  const [phase, setPhase] = useState<ApprovalState>({ kind: 'preview' });
  const [imageLoaded, setImageLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const refreshInFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const approve = async () => {
    if (
      inFlight.current ||
      !imageLoaded ||
      refreshInFlight.current ||
      phase.kind === 'submitted_for_moderation'
    )
      return;
    inFlight.current = true;
    const next = new AbortController();
    controller.current = next;
    setPhase({ kind: 'approving' });
    try {
      const result = await api.approve(
        autographId,
        preview.assetId,
        next.signal,
      );
      if (!next.signal.aborted) {
        setPhase({
          kind: 'submitted_for_moderation',
          approvedAt: result.approvedAt,
        });
      }
    } catch (error) {
      if (!next.signal.aborted)
        setPhase({
          kind: 'approval_error',
          message: approvalError(error),
          legalRequired: needsFirstUseConfirmation(error),
        });
    } finally {
      inFlight.current = false;
      if (controller.current === next) controller.current = null;
    }
  };

  const refresh = async () => {
    if (inFlight.current || refreshInFlight.current) return;
    refreshInFlight.current = true;
    const next = new AbortController();
    controller.current = next;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const result = await api.preview(autographId, next.signal);
      if (!next.signal.aborted) {
        if (result.url !== preview.url || result.assetId !== preview.assetId)
          setImageLoaded(false);
        setPreview(result);
        if (phase.kind === 'approval_error') setPhase({ kind: 'preview' });
      }
    } catch {
      if (!next.signal.aborted)
        setRefreshError('Could not refresh the private preview. Try again.');
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
      if (controller.current === next) controller.current = null;
    }
  };

  return (
    <section className={styles.preview} aria-labelledby="preview-heading">
      <h2 id="preview-heading">{t('Your cleaned preview')}</h2>
      <p>
        {t(
          'This cleaned version is private. Review it before you submit it for moderation.',
        )}
      </p>
      <img
        key={`${preview.assetId}:${preview.url}`}
        src={preview.url}
        alt={t('Cleaned digital autograph preview')}
        referrerPolicy="no-referrer"
        onLoad={() => {
          setImageLoaded(true);
          setRefreshError(null);
        }}
        onError={() => {
          setImageLoaded(false);
          setRefreshError(
            'Preview could not be loaded. Refresh it before approving.',
          );
        }}
      />
      {refreshError && <p role="alert">{t(refreshError)}</p>}
      {phase.kind === 'submitted_for_moderation' ? (
        <div role="status" className={styles.status}>
          <h3>{t('Submitted for moderation')}</h3>
          <p>
            {t(
              'Your approval is recorded. No public placement has occurred yet.',
            )}
          </p>
        </div>
      ) : (
        <div className={styles.approval}>
          <p>
            {t(
              'I approve this cleaned version of my digital autograph and submit it for moderation.',
            )}
          </p>
          <p>
            {t(
              'It is not public yet. It may become public after later moderation and product actions. Do not use a bank or legal signature.',
            )}
          </p>
          {phase.kind === 'approval_error' && (
            <div role="alert">
              {phase.legalRequired ? (
                <FirstUseActionNotice returnTo="/autograph/create" />
              ) : (
                <p>{t(phase.message)}</p>
              )}
            </div>
          )}
          <button
            className={styles.primary}
            type="button"
            onClick={approve}
            disabled={!imageLoaded || refreshing || phase.kind === 'approving'}
          >
            {phase.kind === 'approving'
              ? t('Submitting approval…')
              : phase.kind === 'approval_error'
                ? t('Retry approval')
                : t('Approve and submit for moderation')}
          </button>
        </div>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing || phase.kind === 'approving'}
        >
          {refreshing ? t('Refreshing preview…') : t('Refresh private preview')}
        </button>
        <button
          type="button"
          onClick={onStartOver}
          disabled={refreshing || phase.kind === 'approving'}
        >
          {t('Start a new autograph')}
        </button>
      </div>
    </section>
  );
}
