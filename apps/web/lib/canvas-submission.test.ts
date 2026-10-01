import { describe, expect, it, vi } from 'vitest';
import { AutographApiError, type Autograph } from './autograph-api';
import { submitAutograph, type SubmissionApi } from './canvas-submission';

const draft = {
  id: 'autograph-1',
  source: 'canvas',
  status: 'draft',
} as const satisfies Autograph;
const processing = {
  ...draft,
  status: 'processing',
} as const satisfies Autograph;
const ready = {
  ...draft,
  status: 'awaiting_approval',
} as const satisfies Autograph;

function mockApi(): SubmissionApi {
  return {
    create: vi.fn(async () => draft),
    get: vi.fn(async () => ready),
    initiateUpload: vi.fn(async () => ({
      method: 'PUT' as const,
      url: 'https://storage.test/private',
      headers: { 'If-None-Match': '*', 'Content-Type': 'image/png' },
    })),
    upload: vi.fn(async () => {}),
    complete: vi.fn(async () => processing),
    preview: vi.fn(async () => ({
      assetId: 'cleaned-1',
      url: 'https://storage.test/preview',
      expiresAt: '2026-09-27T00:00:00Z',
    })),
  };
}

describe('autograph submission', () => {
  it('creates, uploads, completes, polls, and fetches the private preview', async () => {
    const api = mockApi();
    const stages: string[] = [];
    const created: string[] = [];
    const result = await submitAutograph(
      api,
      new Blob(['png'], { type: 'image/png' }),
      'canvas',
      new AbortController().signal,
      (stage) => stages.push(stage),
      (id) => created.push(id),
      undefined,
      undefined,
      async () => {},
    );
    expect(created).toEqual(['autograph-1']);
    expect(stages).toEqual([
      'creating',
      'requesting_upload',
      'uploading',
      'completing',
      'processing',
      'loading_preview',
    ]);
    expect(api.initiateUpload).toHaveBeenCalledWith(
      'autograph-1',
      3,
      'image/png',
      expect.any(AbortSignal),
    );
    expect(api.create).toHaveBeenCalledWith('canvas', expect.any(AbortSignal));
    expect(api.upload).toHaveBeenCalledOnce();
    expect(result.previewUrl).toBe('https://storage.test/preview');
  });

  it('resumes an upload-pending draft by completing an already uploaded object', async () => {
    const api = mockApi();
    api.get = vi.fn(async () => ({
      ...draft,
      status: 'upload_pending' as const,
    }));
    api.complete = vi.fn(async () => ready);
    await submitAutograph(
      api,
      new Blob(['png'], { type: 'image/png' }),
      'canvas',
      new AbortController().signal,
      () => {},
      () => {},
      draft.id,
    );
    expect(api.create).not.toHaveBeenCalled();
    expect(api.initiateUpload).not.toHaveBeenCalled();
    expect(api.upload).not.toHaveBeenCalled();
  });

  it('resumes a missing upload using a new signed URL', async () => {
    const api = mockApi();
    api.get = vi.fn(async () => ({
      ...draft,
      status: 'upload_pending' as const,
    }));
    api.complete = vi
      .fn()
      .mockRejectedValueOnce(new AutographApiError('UPLOAD_NOT_FOUND', 404))
      .mockResolvedValueOnce(ready);
    await submitAutograph(
      api,
      new Blob(['png'], { type: 'image/png' }),
      'canvas',
      new AbortController().signal,
      () => {},
      () => {},
      draft.id,
    );
    expect(api.initiateUpload).toHaveBeenCalledOnce();
    expect(api.upload).toHaveBeenCalledOnce();
  });

  it('stops on worker failure without requesting a preview', async () => {
    const api = mockApi();
    api.get = vi.fn(async () => ({
      ...draft,
      status: 'processing_failed' as const,
    }));
    await expect(
      submitAutograph(
        api,
        new Blob(['png'], { type: 'image/png' }),
        'canvas',
        new AbortController().signal,
        () => {},
        () => {},
        undefined,
        undefined,
        async () => {},
      ),
    ).rejects.toThrow(/Processing failed/);
    expect(api.preview).not.toHaveBeenCalled();
  });

  it('creates a photo autograph and reserves the upload using the edited blob MIME type', async () => {
    const api = mockApi();
    api.create = vi.fn(async (source: Autograph['source']) => ({
      ...draft,
      source,
    }));
    const progress: number[] = [];
    api.upload = vi.fn(async (...args: Parameters<SubmissionApi['upload']>) => {
      args[3]?.(0.5);
    });
    const photo = new Blob(['edited'], { type: 'image/jpeg' });
    await submitAutograph(
      api,
      photo,
      'photo',
      new AbortController().signal,
      () => {},
      () => {},
      undefined,
      (value) => progress.push(value),
      async () => {},
    );
    expect(api.create).toHaveBeenCalledWith('photo', expect.any(AbortSignal));
    expect(api.initiateUpload).toHaveBeenCalledWith(
      'autograph-1',
      photo.size,
      'image/jpeg',
      expect.any(AbortSignal),
    );
    expect(api.upload).toHaveBeenCalledWith(
      expect.any(Object),
      photo,
      expect.any(AbortSignal),
      expect.any(Function),
    );
    expect(progress).toEqual([0.5]);
  });

  it('rejects unsupported image content before creating a draft', async () => {
    const api = mockApi();
    await expect(
      submitAutograph(
        api,
        new Blob(['other'], { type: 'image/webp' }),
        'photo',
        new AbortController().signal,
        () => {},
        () => {},
      ),
    ).rejects.toThrow(/PNG or JPEG/);
    expect(api.create).not.toHaveBeenCalled();
  });
});
