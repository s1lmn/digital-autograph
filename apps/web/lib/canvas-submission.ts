import { AutographApiError, type Autograph } from './autograph-api';

export type SubmissionStage =
  | 'creating'
  | 'requesting_upload'
  | 'uploading'
  | 'completing'
  | 'processing'
  | 'loading_preview';

export type SubmissionApi = {
  create(signal: AbortSignal): Promise<Autograph>;
  get(id: string, signal: AbortSignal): Promise<Autograph>;
  initiateUpload(
    id: string,
    sizeBytes: number,
    signal: AbortSignal,
  ): Promise<{
    method: 'PUT';
    url: string;
    headers: Record<string, string>;
  }>;
  upload(
    signed: { method: 'PUT'; url: string; headers: Record<string, string> },
    png: Blob,
    signal: AbortSignal,
  ): Promise<void>;
  complete(id: string, signal: AbortSignal): Promise<Autograph>;
  preview(
    id: string,
    signal: AbortSignal,
  ): Promise<{ assetId: string; url: string; expiresAt: string }>;
};

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

export async function submitCanvas(
  api: SubmissionApi,
  png: Blob,
  signal: AbortSignal,
  onStage: (stage: SubmissionStage) => void,
  onCreated: (id: string) => void,
  existingId?: string,
  pause: (ms: number, signal: AbortSignal) => Promise<void> = wait,
): Promise<{
  id: string;
  previewAssetId: string;
  previewUrl: string;
  expiresAt: string;
}> {
  let autograph: Autograph;
  if (existingId) {
    autograph = await api.get(existingId, signal);
  } else {
    onStage('creating');
    autograph = await api.create(signal);
    onCreated(autograph.id);
  }

  if (autograph.status === 'draft' || autograph.status === 'upload_pending') {
    if (autograph.status === 'upload_pending') {
      onStage('completing');
      try {
        autograph = await api.complete(autograph.id, signal);
      } catch (error) {
        if (
          !(error instanceof AutographApiError) ||
          error.code !== 'UPLOAD_NOT_FOUND'
        ) {
          throw error;
        }
      }
    }
    if (autograph.status === 'draft' || autograph.status === 'upload_pending') {
      onStage('requesting_upload');
      const signed = await api.initiateUpload(autograph.id, png.size, signal);
      onStage('uploading');
      try {
        await api.upload(signed, png, signal);
      } catch (error) {
        if (!(error instanceof AutographApiError) || error.status !== 412)
          throw error;
      }
      onStage('completing');
      autograph = await api.complete(autograph.id, signal);
    }
  }

  onStage('processing');
  for (let attempt = 0; attempt < 60; attempt++) {
    if (signal.aborted) throw signal.reason;
    if (autograph.status === 'awaiting_approval') {
      onStage('loading_preview');
      const preview = await api.preview(autograph.id, signal);
      return {
        id: autograph.id,
        previewAssetId: preview.assetId,
        previewUrl: preview.url,
        expiresAt: preview.expiresAt,
      };
    }
    if (autograph.status === 'processing_failed') {
      throw new Error('Processing failed. Please start a new drawing.');
    }
    await pause(1500, signal);
    autograph = await api.get(autograph.id, signal);
  }
  throw new Error(
    'Processing is taking longer than expected. Try checking again.',
  );
}
