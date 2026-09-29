// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CanvasCreateScreen } from './canvas-create-screen';

vi.mock('../lib/drawing', () => ({
  exportPng: vi.fn(async () => new Blob(['drawing'], { type: 'image/png' })),
}));

vi.mock('./canvas-editor', () => ({
  CanvasEditor: (props: {
    onDrawingChange: (hasMarks: boolean) => void;
    onStrokesChange: (strokes: readonly { points: never[] }[]) => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        props.onDrawingChange(true);
        props.onStrokesChange([{ points: [] }]);
      }}
    >
      Add a test drawing
    </button>
  ),
}));

vi.mock('./photo-upload-editor', () => ({
  PhotoUploadEditor: (props: {
    onPhotoChange: (blob: Blob | null) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        props.onPhotoChange(new Blob(['edited-photo'], { type: 'image/jpeg' }))
      }
    >
      Use an edited test photo
    </button>
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function installApi(failFirstUpload = false) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let source = 'canvas';
  let uploadAttempts = 0;
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/autographs')) {
        const body = JSON.parse(String(init?.body)) as { source: string };
        source = body.source;
        return response({ id: 'autograph-1', source, status: 'draft' });
      }
      if (url.endsWith('/autographs/autograph-1')) {
        return response({ id: 'autograph-1', source, status: 'draft' });
      }
      if (url.endsWith('/autographs/autograph-1/upload')) {
        return response({
          method: 'PUT',
          url: 'https://private-storage.test/signed-upload',
          headers: {
            'Content-Type': JSON.parse(String(init?.body)).contentType,
          },
          expiresAt: 'later',
        });
      }
      if (url.endsWith('/autographs/autograph-1/upload/complete')) {
        return response({
          id: 'autograph-1',
          source,
          status: 'awaiting_approval',
        });
      }
      if (url.endsWith('/autographs/autograph-1/preview')) {
        return response({
          assetId: 'cleaned-asset',
          url: 'https://private-preview.test/cleaned',
          expiresAt: 'later',
        });
      }
      throw new Error(`Unexpected API request: ${url}`);
    },
  );
  vi.stubGlobal('fetch', fetchMock);

  const requests: MockUploadRequest[] = [];
  class MockUploadRequest {
    upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
      onprogress: null,
    };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    status = 200;
    withCredentials = true;
    method = '';
    url = '';
    sentBody: Blob | null = null;
    headers: Record<string, string> = {};

    constructor() {
      requests.push(this);
    }
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    }
    send(body: Blob) {
      this.sentBody = body;
      uploadAttempts += 1;
      this.upload.onprogress?.({
        lengthComputable: true,
        loaded: body.size,
        total: body.size,
      } as ProgressEvent);
      setTimeout(() => {
        this.status = failFirstUpload && uploadAttempts === 1 ? 500 : 200;
        this.onload?.();
      }, 0);
    }
    abort() {
      this.onabort?.();
    }
  }
  vi.stubGlobal('XMLHttpRequest', MockUploadRequest);
  return { calls, requests };
}

function response(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

describe('autograph creation method selection', () => {
  it('submits an edited photo through the private photo upload and cleaned preview flow', async () => {
    const { calls, requests } = installApi();
    render(<CanvasCreateScreen apiOrigin="http://127.0.0.1:4000" />);
    fireEvent.click(screen.getByRole('button', { name: 'Photo' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Use an edited test photo' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Create private preview' }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Your cleaned preview' }),
    ).toBeTruthy();
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      source: 'photo',
    });
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      contentType: 'image/jpeg',
      sizeBytes: 12,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: 'PUT',
      url: 'https://private-storage.test/signed-upload',
      withCredentials: false,
      headers: { 'Content-Type': 'image/jpeg' },
      sentBody: expect.objectContaining({ type: 'image/jpeg', size: 12 }),
    });
  });

  it('retries a failed photo upload with the same draft and edited blob', async () => {
    const { calls, requests } = installApi(true);
    render(<CanvasCreateScreen apiOrigin="http://127.0.0.1:4000" />);
    fireEvent.click(screen.getByRole('button', { name: 'Photo' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Use an edited test photo' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Create private preview' }),
    );

    expect((await screen.findByRole('alert')).textContent).toContain(
      'The request failed (UPLOAD_FAILED)',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(
      await screen.findByRole('heading', { name: 'Your cleaned preview' }),
    ).toBeTruthy();
    expect(calls.filter(({ url }) => url.endsWith('/autographs'))).toHaveLength(
      1,
    );
    expect(requests).toHaveLength(2);
    expect(requests[0]?.sentBody).toBe(requests[1]?.sentBody);
  });

  it('keeps Draw as the default and uses the existing canvas source and PNG upload', async () => {
    const { calls, requests } = installApi();
    render(<CanvasCreateScreen apiOrigin="http://127.0.0.1:4000" />);
    expect(
      screen.getByRole('button', { name: 'Draw' }).getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Add a test drawing' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Create private preview' }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Your cleaned preview' }),
    ).toBeTruthy();
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      source: 'canvas',
    });
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      contentType: 'image/png',
      sizeBytes: 7,
    });
    expect(requests[0]).toMatchObject({
      method: 'PUT',
      withCredentials: false,
      headers: { 'Content-Type': 'image/png' },
      sentBody: expect.objectContaining({ type: 'image/png', size: 7 }),
    });
  });
});
