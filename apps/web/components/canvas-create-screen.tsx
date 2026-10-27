'use client';
import { useLocale } from './locale-provider';

import { useCallback, useEffect, useRef, useState } from 'react';
import { autographApi, AutographApiError } from '../lib/autograph-api';
import {
  submitAutograph,
  type SubmissionStage,
} from '../lib/canvas-submission';
import { exportPng, type Stroke } from '../lib/drawing';
import { CanvasEditor } from './canvas-editor';
import { CleanedAutographReview } from './cleaned-autograph-review';
import {
  FirstUseActionNotice,
  needsFirstUseConfirmation,
} from './first-use-action-notice';
import { PhotoUploadEditor } from './photo-upload-editor';
import styles from './canvas-create-screen.module.css';

type ScreenState =
  | { kind: 'editing' }
  | { kind: 'working'; stage: SubmissionStage; progress?: number }
  | { kind: 'error'; message: string; legalRequired?: boolean }
  | { kind: 'preview'; assetId: string; url: string; expiresAt: string };

type CreationMode = 'draw' | 'photo';

const stageLabels: Record<SubmissionStage, string> = {
  creating: 'Creating your private draft…',
  requesting_upload: 'Preparing private upload…',
  uploading: 'Uploading your autograph…',
  completing: 'Verifying upload…',
  processing: 'Cleaning your autograph…',
  loading_preview: 'Loading your private preview…',
};

function errorMessage(error: unknown): string {
  if (error instanceof AutographApiError) {
    if (error.status === 401)
      return 'Your session expired. Sign in again, then start a new autograph.';
    if (error.code === 'UPLOAD_METADATA_MISMATCH')
      return 'The upload could not be verified. Start a new autograph.';
    if (error.code === 'INVALID_AUTOGRAPH_STATE')
      return 'This draft cannot be uploaded again. Start a new autograph.';
    return `The request failed (${error.code}). Retry when the connection is available.`;
  }
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Please retry.';
}

export function CanvasCreateScreen({ apiOrigin }: { apiOrigin: string }) {
  const { t } = useLocale();

  const api = useRef(autographApi(apiOrigin));
  const strokes = useRef<readonly Stroke[]>([]);
  const image = useRef<Blob | null>(null);
  const autographId = useRef<string | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const [mode, setMode] = useState<CreationMode>('draw');
  const [hasMarks, setHasMarks] = useState(false);
  const [hasPhoto, setHasPhoto] = useState(false);
  const [state, setState] = useState<ScreenState>({ kind: 'editing' });
  const [editorKey, setEditorKey] = useState(0);

  useEffect(() => () => controller.current?.abort(), []);

  const onPhotoChange = useCallback((blob: Blob | null) => {
    image.current = blob;
    setHasPhoto(Boolean(blob));
  }, []);

  const run = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const nextController = new AbortController();
    controller.current = nextController;
    try {
      if (mode === 'draw' && !image.current)
        image.current = await exportPng(strokes.current);
      if (!image.current) {
        throw new Error(
          mode === 'draw'
            ? 'Draw an autograph before continuing.'
            : 'Choose and edit a photo before continuing.',
        );
      }
      if (nextController.signal.aborted) return;
      const result = await submitAutograph(
        api.current,
        image.current,
        mode === 'draw' ? 'canvas' : 'photo',
        nextController.signal,
        (stage) =>
          setState({
            kind: 'working',
            stage,
            ...(stage === 'uploading' ? { progress: 0 } : {}),
          }),
        (id) => {
          autographId.current = id;
        },
        autographId.current,
        (progress) =>
          setState((current) =>
            current.kind === 'working' && current.stage === 'uploading'
              ? { ...current, progress }
              : current,
          ),
      );
      setState({
        kind: 'preview',
        assetId: result.previewAssetId,
        url: result.previewUrl,
        expiresAt: result.expiresAt,
      });
    } catch (error) {
      if (!nextController.signal.aborted)
        setState({
          kind: 'error',
          message: errorMessage(error),
          legalRequired: needsFirstUseConfirmation(error),
        });
    } finally {
      busy.current = false;
      if (controller.current === nextController) controller.current = null;
    }
  }, [mode]);

  const startOver = () => {
    if (busy.current) return;
    strokes.current = [];
    image.current = null;
    autographId.current = undefined;
    setHasMarks(false);
    setHasPhoto(false);
    setEditorKey((key) => key + 1);
    setState({ kind: 'editing' });
  };

  const selectMode = (nextMode: CreationMode) => {
    if (busy.current || autographId.current || mode === nextMode) return;
    strokes.current = [];
    image.current = null;
    setHasMarks(false);
    setHasPhoto(false);
    setEditorKey((key) => key + 1);
    setMode(nextMode);
    setState({ kind: 'editing' });
  };

  const refreshPreview = async () => {
    if (busy.current || !autographId.current) return;
    busy.current = true;
    const nextController = new AbortController();
    controller.current = nextController;
    setState({ kind: 'working', stage: 'loading_preview' });
    try {
      const preview = await api.current.preview(
        autographId.current,
        nextController.signal,
      );
      setState({
        kind: 'preview',
        assetId: preview.assetId,
        url: preview.url,
        expiresAt: preview.expiresAt,
      });
    } catch (error) {
      if (!nextController.signal.aborted)
        setState({
          kind: 'error',
          message: errorMessage(error),
          legalRequired: needsFirstUseConfirmation(error),
        });
    } finally {
      busy.current = false;
      if (controller.current === nextController) controller.current = null;
    }
  };

  return (
    <div className={styles.flow}>
      {state.kind !== 'preview' && (
        <div
          className={styles.modeTabs}
          role="group"
          aria-label={t('Creation method')}
        >
          <button
            className={mode === 'draw' ? styles.activeTab : styles.tab}
            type="button"
            aria-pressed={mode === 'draw'}
            disabled={state.kind === 'working' || Boolean(autographId.current)}
            onClick={() => selectMode('draw')}
          >
            {t('Draw')}
          </button>
          <button
            className={mode === 'photo' ? styles.activeTab : styles.tab}
            type="button"
            aria-pressed={mode === 'photo'}
            disabled={state.kind === 'working' || Boolean(autographId.current)}
            onClick={() => selectMode('photo')}
          >
            {t('Photo')}
          </button>
        </div>
      )}
      {state.kind !== 'preview' &&
        (mode === 'draw' ? (
          <CanvasEditor
            key={editorKey}
            onDrawingChange={(hasDrawing) => {
              setHasMarks(hasDrawing);
              if (!hasDrawing) image.current = null;
            }}
            onStrokesChange={(value) => {
              strokes.current = value;
              image.current = null;
            }}
            disabled={state.kind === 'working' || Boolean(autographId.current)}
          />
        ) : (
          <PhotoUploadEditor
            key={editorKey}
            onPhotoChange={onPhotoChange}
            disabled={state.kind === 'working' || Boolean(autographId.current)}
          />
        ))}
      {state.kind === 'editing' && (
        <button
          className={styles.primary}
          type="button"
          onClick={run}
          disabled={mode === 'draw' ? !hasMarks : !hasPhoto}
        >
          {t('Create private preview')}
        </button>
      )}
      {state.kind === 'working' && (
        <div role="status" aria-live="polite" className={styles.status}>
          <p>{t(stageLabels[state.stage])}</p>
          {state.stage === 'uploading' && (
            <progress
              aria-label={t('Upload progress')}
              max={1}
              value={state.progress ?? 0}
            />
          )}
        </div>
      )}
      {state.kind === 'error' && (
        <div className={styles.error} role="alert">
          {state.legalRequired ? (
            <FirstUseActionNotice returnTo="/autograph/create" />
          ) : (
            <p>{t(state.message)}</p>
          )}
          <div className={styles.actions}>
            {image.current && (
              <button type="button" onClick={run}>
                {t('Retry')}
              </button>
            )}
            <button type="button" onClick={startOver}>
              {t('Start a new autograph')}
            </button>
            <button
              type="button"
              onClick={refreshPreview}
              disabled={!autographId.current}
            >
              {t('Refresh preview')}
            </button>
          </div>
        </div>
      )}
      {state.kind === 'preview' && (
        <CleanedAutographReview
          api={api.current}
          autographId={autographId.current!}
          initialPreview={state}
          onStartOver={startOver}
        />
      )}
    </div>
  );
}
