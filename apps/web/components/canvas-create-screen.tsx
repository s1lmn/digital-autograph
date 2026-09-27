'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { autographApi, AutographApiError } from '../lib/autograph-api';
import { submitCanvas, type SubmissionStage } from '../lib/canvas-submission';
import { exportPng, type Stroke } from '../lib/drawing';
import { CanvasEditor } from './canvas-editor';
import styles from './canvas-create-screen.module.css';

type ScreenState =
  | { kind: 'editing' }
  | { kind: 'working'; stage: SubmissionStage }
  | { kind: 'error'; message: string }
  | { kind: 'preview'; url: string; expiresAt: string };

const stageLabels: Record<SubmissionStage, string> = {
  creating: 'Creating your private draft…',
  requesting_upload: 'Preparing private upload…',
  uploading: 'Uploading your drawing…',
  completing: 'Verifying upload…',
  processing: 'Cleaning your autograph…',
  loading_preview: 'Loading your private preview…',
};

function errorMessage(error: unknown): string {
  if (error instanceof AutographApiError) {
    if (error.status === 401)
      return 'Your session expired. Sign in again, then start a new drawing.';
    if (error.code === 'UPLOAD_METADATA_MISMATCH')
      return 'The upload could not be verified. Start a new drawing.';
    if (error.code === 'INVALID_AUTOGRAPH_STATE')
      return 'This draft cannot be uploaded again. Start a new drawing.';
    return `The request failed (${error.code}). Retry when the connection is available.`;
  }
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Please retry.';
}

export function CanvasCreateScreen({ apiOrigin }: { apiOrigin: string }) {
  const api = useRef(autographApi(apiOrigin));
  const strokes = useRef<readonly Stroke[]>([]);
  const png = useRef<Blob | null>(null);
  const autographId = useRef<string | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const [hasMarks, setHasMarks] = useState(false);
  const [state, setState] = useState<ScreenState>({ kind: 'editing' });
  const [editorKey, setEditorKey] = useState(0);

  useEffect(() => () => controller.current?.abort(), []);

  const run = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const nextController = new AbortController();
    controller.current = nextController;
    try {
      if (!png.current) png.current = await exportPng(strokes.current);
      if (nextController.signal.aborted) return;
      const result = await submitCanvas(
        api.current,
        png.current,
        nextController.signal,
        (stage) => setState({ kind: 'working', stage }),
        (id) => {
          autographId.current = id;
        },
        autographId.current,
      );
      setState({
        kind: 'preview',
        url: result.previewUrl,
        expiresAt: result.expiresAt,
      });
    } catch (error) {
      if (!nextController.signal.aborted)
        setState({ kind: 'error', message: errorMessage(error) });
    } finally {
      busy.current = false;
      if (controller.current === nextController) controller.current = null;
    }
  }, []);

  const startOver = () => {
    if (busy.current) return;
    strokes.current = [];
    png.current = null;
    autographId.current = undefined;
    setHasMarks(false);
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
        url: preview.url,
        expiresAt: preview.expiresAt,
      });
    } catch (error) {
      if (!nextController.signal.aborted)
        setState({ kind: 'error', message: errorMessage(error) });
    } finally {
      busy.current = false;
      if (controller.current === nextController) controller.current = null;
    }
  };

  return (
    <div className={styles.flow}>
      {state.kind !== 'preview' && (
        <CanvasEditor
          key={editorKey}
          onDrawingChange={setHasMarks}
          onStrokesChange={(value) => {
            strokes.current = value;
            png.current = null;
          }}
          disabled={state.kind === 'working' || Boolean(autographId.current)}
        />
      )}
      {state.kind === 'editing' && (
        <button
          className={styles.primary}
          type="button"
          onClick={run}
          disabled={!hasMarks}
        >
          Create private preview
        </button>
      )}
      {state.kind === 'working' && (
        <p role="status" aria-live="polite" className={styles.status}>
          {stageLabels[state.stage]}
        </p>
      )}
      {state.kind === 'error' && (
        <div className={styles.error} role="alert">
          <p>{state.message}</p>
          <div className={styles.actions}>
            {png.current && (
              <button type="button" onClick={run}>
                Retry
              </button>
            )}
            <button type="button" onClick={startOver}>
              Start a new drawing
            </button>
            <button
              type="button"
              onClick={refreshPreview}
              disabled={!autographId.current}
            >
              Refresh preview
            </button>
          </div>
        </div>
      )}
      {state.kind === 'preview' && (
        <section className={styles.preview} aria-labelledby="preview-heading">
          <h2 id="preview-heading">Your cleaned preview</h2>
          <p>
            The worker has cleaned your image. This is private and awaiting a
            later approval step.
          </p>
          <img
            src={state.url}
            alt="Cleaned digital autograph preview"
            referrerPolicy="no-referrer"
          />
          <div className={styles.actions}>
            <button type="button" onClick={refreshPreview}>
              Refresh private preview
            </button>
            <button type="button" onClick={startOver}>
              Start a new drawing
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
