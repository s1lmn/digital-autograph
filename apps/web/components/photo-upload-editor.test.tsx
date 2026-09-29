// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { PhotoUploadEditor } from './photo-upload-editor';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('photo autograph editor', () => {
  it('offers gallery and mobile-camera input, then previews a locally cropped and rotated JPEG', async () => {
    class MockImage {
      width = 1600;
      height = 900;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    class MockURL extends URL {
      static createObjectURL = vi.fn(() => 'blob:local-image');
      static revokeObjectURL = vi.fn();
    }
    vi.stubGlobal('Image', MockImage);
    vi.stubGlobal('URL', MockURL);
    const context = {
      fillRect: vi.fn(),
      save: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      drawImage: vi.fn(),
      restore: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      function (callback, type) {
        callback(new Blob(['edited-image'], { type }));
      },
    );
    const onPhotoChange = vi.fn();
    render(<PhotoUploadEditor onPhotoChange={onPhotoChange} />);
    const original = new File(['original'], 'autograph.jpg', {
      type: 'image/jpeg',
    });

    expect(screen.getByLabelText('Choose a photo').getAttribute('accept')).toBe(
      'image/jpeg,image/png',
    );
    expect(screen.getByLabelText('Take a photo').getAttribute('capture')).toBe(
      'environment',
    );
    fireEvent.change(screen.getByLabelText('Choose a photo'), {
      target: { files: [original] },
    });

    expect(
      await screen.findByAltText('Edited autograph photo preview'),
    ).toBeTruthy();
    await waitFor(() =>
      expect(onPhotoChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: 'image/jpeg' }),
      ),
    );
    expect(onPhotoChange.mock.lastCall?.[0]).not.toBe(original);
    expect(onPhotoChange.mock.lastCall?.[0]).not.toBeInstanceOf(File);
    const previousCallCount = onPhotoChange.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Rotate 90°' }));
    fireEvent.change(screen.getByLabelText('Zoom'), {
      target: { value: '1.5' },
    });
    await waitFor(() =>
      expect(onPhotoChange.mock.calls.length).toBeGreaterThan(
        previousCallCount,
      ),
    );
    expect(context.rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(
      await screen.findByRole('heading', { name: 'Edited photo preview' }),
    ).toBeTruthy();
  });

  it('rejects unsupported formats without making a preview blob available', async () => {
    const onPhotoChange = vi.fn();
    render(<PhotoUploadEditor onPhotoChange={onPhotoChange} />);
    fireEvent.change(screen.getByLabelText('Choose a photo'), {
      target: {
        files: [
          new File(['original'], 'autograph.webp', { type: 'image/webp' }),
        ],
      },
    });
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Choose a PNG or JPEG photo.',
    );
    expect(onPhotoChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByAltText('Edited autograph photo preview')).toBeNull();
  });
});
