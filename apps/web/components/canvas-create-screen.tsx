'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { autographApi, AutographApiError } from '../lib/autograph-api';
import { submitCanvas, type SubmissionStage } from '../lib/canvas-submission';
import { exportPng, type Stroke } from '../lib/drawing';
import { CanvasEditor } from './canvas-editor';
import { PhotoUploadEditor } from './photo-upload-editor';
import { CleanedAutographReview } from './cleaned-autograph-review';
import styles from './canvas-create-screen.module.css';

type ScreenState =
  | { kind: 'editing' }
  | { kind: 'working'; stage: SubmissionStage }
  | { kind: 'error'; message: string }
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
      return 'Your session expired. Sign in again, then start a new draft.';
    if (error.code === 'UPLOAD_METADATA_MISMATCH')
      return 'The upload could not be verified. Please try again.';
    if (error.code === 'INVALID_AUTOGRAPH_STATE')
      return 'This draft cannot be uploaded again. Start over.';
    return `The request failed (${error.code}). Retry when the connection is available.`;
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please retry.';
}

export function CanvasCreateScreen({ apiOrigin }: { apiOrigin: string }) {
  const api = useRef(autographApi(apiOrigin));
  const [mode, setMode] = useState<CreationMode>('draw');

  // Режим рисования
  const strokes = useRef<readonly Stroke[]>([]);
  const [hasMarks, setHasMarks] = useState(false);

  // Режим фото
  const photoBlobRef = useRef<Blob | null>(null);
  const [hasPhoto, setHasPhoto] = useState(false);

  // Итоговый blob для сабмита / retry
  const activeBlob = useRef<Blob | null>(null);
  const autographId = useRef<string | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);
  const busy = useRef(false);

  const [state, setState] = useState<ScreenState>({ kind: 'editing' });
  const [editorKey, setEditorKey] = useState(0);

  useEffect(() => () => controller.current?.abort(), []);

  const run = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const nextController = new AbortController();
    controller.current = nextController;

    try {
      // Подготавливаем Blob в зависимости от активного режима
      if (!activeBlob.current) {
        if (mode === 'draw') {
          activeBlob.current = await exportPng(strokes.current);
        } else {
          activeBlob.current = photoBlobRef.current;
        }
      }

      if (!activeBlob.current) {
        throw new Error('Please draw an autograph or select a photo first.');
      }

      if (nextController.signal.aborted) return;

      const result = await submitCanvas(
        api.current,
        activeBlob.current,
        nextController.signal,
        (stage) => setState({ kind: 'working', stage }),
        (id) => {
          autographId.current = id;
        },
        autographId.current,
      );

      setState({
        kind: 'preview',
        assetId: result.previewAssetId,
        url: result.previewUrl,
        expiresAt: result.expiresAt,
      });
    } catch (error) {
      if (!nextController.signal.aborted) {
        setState({ kind: 'error', message: errorMessage(error) });
      }
    } finally {
      busy.current = false;
      if (controller.current === nextController) controller.current = null;
    }
  }, [mode]);

  const startOver = () => {
    if (busy.current) return;
    strokes.current = [];
    photoBlobRef.current = null;
    activeBlob.current = null;
    autographId.current = undefined;
    setHasMarks(false);
    setHasPhoto(false);
    setEditorKey((key) => key + 1);
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
      if (!nextController.signal.aborted) {
        setState({ kind: 'error', message: errorMessage(error) });
      }
    } finally {
      busy.current = false;
      if (controller.current === nextController) controller.current = null;
    }
  };

  const isSubmitDisabled =
    state.kind === 'working' ||
    Boolean(autographId.current) ||
    (mode === 'draw' ? !hasMarks : !hasPhoto);

  return (
    <div className={styles.screen}>
      {state.kind !== 'preview' && (
        <>
          {/* Переключение табов */}
          <div className={styles.modeTabs} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'draw'}
              className={mode === 'draw' ? styles.activeTab : styles.tab}
              onClick={() => {
                if (state.kind === 'editing') {
                  setMode('draw');
                  activeBlob.current = null;
                }
              }}
              disabled={state.kind === 'working' || Boolean(autographId.current)}
            >
              ✏️ Draw
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'photo'}
              className={mode === 'photo' ? styles.activeTab : styles.tab}
              onClick={() => {
                if (state.kind === 'editing') {
                  setMode('photo');
                  activeBlob.current = null;
                }
              }}
              disabled={state.kind === 'working' || Boolean(autographId.current)}
            >
              📷 Upload Photo
            </button>
          </div>

          {/* Отображение соответствующего редактора */}
          {mode === 'draw' ? (
            <CanvasEditor
              key={`canvas-${editorKey}`}
              onDrawingChange={setHasMarks}
              onStrokesChange={(value) => {
                strokes.current = value;
                activeBlob.current = null;
              }}
              disabled={state.kind === 'working' || Boolean(autographId.current)}
            />
          ) : (
            <PhotoUploadEditor
              key={`photo-${editorKey}`}
              onPhotoChange={(blob) => {
                photoBlobRef.current = blob;
                activeBlob.current = blob;
                setHasPhoto(Boolean(blob));
              }}
              disabled={state.kind === 'working' || Boolean(autographId.current)}
            />
          )}
        </>
      )}

      {/* Кнопка отправки на создание приватного превью */}
      {state.kind === 'editing' && (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.submitButton}
            onClick={run}
            disabled={isSubmitDisabled}
          >
            Create private preview
          </button>
        </div>
      )}

      {/* Статусы обработки */}
      {state.kind === 'working' && (
        <div className={styles.statusBox} role="status">
          <p>{stageLabels[state.stage]}</p>
        </div>
      )}

      {/* Ошибки и Retry */}
      {state.kind === 'error' && (
        <div className={styles.errorBox} role="alert">
          <p>{state.message}</p>
          <div className={styles.errorActions}>
            {activeBlob.current && (
              <button type="button" onClick={run}>
                Retry
              </button>
            )}
            <button type="button" onClick={startOver}>
              Start over
            </button>
            {autographId.current && (
              <button type="button" onClick={refreshPreview}>
                Refresh preview
              </button>
            )}
          </div>
        </div>
      )}

      {/* Финальное превью (Cleaned Autograph) */}
      {state.kind === 'preview' && (
        <CleanedAutographReview
          assetId={state.assetId}
          previewUrl={state.url}
          expiresAt={state.expiresAt}
          onStartOver={startOver}
        />
      )}
    </div>
  );
}