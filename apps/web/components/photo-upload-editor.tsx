'use client';

import { useEffect, useRef, useState } from 'react';
import {
  drawingHeight,
  drawingWidth,
  maxCanvasUploadBytes,
} from '../lib/drawing';
import styles from './photo-upload-editor.module.css';

type PhotoUploadEditorProps = {
  onPhotoChange: (blob: Blob | null) => void;
  disabled?: boolean;
};

function isSupportedType(type: string): type is 'image/jpeg' | 'image/png' {
  return type === 'image/jpeg' || type === 'image/png';
}

export function PhotoUploadEditor({
  onPhotoChange,
  disabled = false,
}: PhotoUploadEditorProps) {
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [format, setFormat] = useState<'image/jpeg' | 'image/png'>(
    'image/jpeg',
  );
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const dragStart = useRef<{
    clientX: number;
    clientY: number;
    x: number;
    y: number;
  } | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const onPhotoChangeRef = useRef(onPhotoChange);
  const renderGeneration = useRef(0);
  onPhotoChangeRef.current = onPhotoChange;

  const clearPreview = () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
  };

  useEffect(() => {
    if (!sourceUrl) {
      setImage(null);
      return;
    }
    const loadedImage = new Image();
    loadedImage.onload = () => {
      setImage(loadedImage);
      setError(null);
    };
    loadedImage.onerror = () => {
      setImage(null);
      setError('This image could not be opened. Choose a PNG or JPEG photo.');
      onPhotoChangeRef.current(null);
    };
    loadedImage.src = sourceUrl;
    return () => {
      URL.revokeObjectURL(sourceUrl);
      loadedImage.onload = null;
      loadedImage.onerror = null;
    };
  }, [sourceUrl]);

  useEffect(() => {
    if (!image) return;
    const generation = ++renderGeneration.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) {
      setError('Photo editing is unavailable in this browser.');
      onPhotoChangeRef.current(null);
      return;
    }

    onPhotoChangeRef.current(null);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setError(null);
    canvas.width = drawingWidth;
    canvas.height = drawingHeight;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, drawingWidth, drawingHeight);
    const rotated = rotation % 180 !== 0;
    const naturalWidth = rotated ? image.height : image.width;
    const naturalHeight = rotated ? image.width : image.height;
    const scale =
      Math.max(drawingWidth / naturalWidth, drawingHeight / naturalHeight) *
      zoom;
    const imageWidth = image.width * scale;
    const imageHeight = image.height * scale;
    const rotatedWidth = naturalWidth * scale;
    const rotatedHeight = naturalHeight * scale;
    const x = Math.max(
      -Math.max(0, (rotatedWidth - drawingWidth) / 2),
      Math.min(Math.max(0, (rotatedWidth - drawingWidth) / 2), offset.x),
    );
    const y = Math.max(
      -Math.max(0, (rotatedHeight - drawingHeight) / 2),
      Math.min(Math.max(0, (rotatedHeight - drawingHeight) / 2), offset.y),
    );

    context.save();
    context.translate(drawingWidth / 2 + x, drawingHeight / 2 + y);
    context.rotate((rotation * Math.PI) / 180);
    context.drawImage(
      image,
      -imageWidth / 2,
      -imageHeight / 2,
      imageWidth,
      imageHeight,
    );
    context.restore();

    const timer = window.setTimeout(() => {
      canvas.toBlob(
        (blob) => {
          if (generation !== renderGeneration.current) return;
          if (!blob || blob.type !== format || blob.size === 0) {
            setError(
              'Could not prepare this photo. Adjust it or choose another.',
            );
            return;
          }
          if (blob.size > maxCanvasUploadBytes) {
            setError(
              'The edited photo is too large. Zoom in or choose another.',
            );
            return;
          }
          const nextUrl = URL.createObjectURL(blob);
          previewUrlRef.current = nextUrl;
          setPreviewUrl(nextUrl);
          onPhotoChangeRef.current(blob);
        },
        format,
        format === 'image/jpeg' ? 0.92 : undefined,
      );
    }, 120);
    return () => {
      window.clearTimeout(timer);
      renderGeneration.current += 1;
    };
  }, [format, image, offset, rotation, zoom]);

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      onPhotoChangeRef.current(null);
    },
    [],
  );

  const chooseFile = (file?: File) => {
    if (!file) return;
    renderGeneration.current += 1;
    clearPreview();
    setImage(null);
    onPhotoChangeRef.current(null);
    const fileType = file.type;
    if (!isSupportedType(fileType)) {
      setSourceUrl(null);
      setError('Choose a PNG or JPEG photo.');
      return;
    }
    if (file.size === 0 || file.size > maxCanvasUploadBytes) {
      setSourceUrl(null);
      setError('Choose a photo no larger than 10 MB.');
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    setSourceUrl(nextUrl);
    setFormat(fileType);
    setRotation(0);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setError(null);
  };

  const readFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    chooseFile(event.currentTarget.files?.[0]);
    event.currentTarget.value = '';
  };

  return (
    <section aria-labelledby="photo-upload-heading" className={styles.editor}>
      <div>
        <h2 id="photo-upload-heading">Use a photo</h2>
        <p>
          Choose a photo or take one with your phone. Crop and rotate it here;
          only the edited image is uploaded.
        </p>
        <p className={styles.photoHint}>
          For best results, photograph your signature on clean, unlined paper.
        </p>
      </div>
      <input
        ref={imageInputRef}
        className={styles.fileInput}
        type="file"
        accept="image/jpeg,image/png"
        aria-label="Choose a photo"
        onChange={readFileInput}
        disabled={disabled}
      />
      <input
        ref={cameraInputRef}
        className={styles.fileInput}
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="Take a photo"
        onChange={readFileInput}
        disabled={disabled}
      />
      <div className={styles.actions}>
        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          disabled={disabled}
        >
          Take a photo
        </button>
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          disabled={disabled}
        >
          Choose a photo
        </button>
      </div>
      {sourceUrl && (
        <>
          <div className={styles.cropArea}>
            <canvas
              ref={canvasRef}
              aria-label="Crop preview"
              className={styles.canvas}
              onPointerDown={(event) => {
                if (disabled) return;
                dragStart.current = {
                  clientX: event.clientX,
                  clientY: event.clientY,
                  ...offset,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (!dragStart.current || disabled) return;
                const rect = event.currentTarget.getBoundingClientRect();
                setOffset({
                  x:
                    dragStart.current.x +
                    ((event.clientX - dragStart.current.clientX) /
                      Math.max(rect.width, 1)) *
                      drawingWidth,
                  y:
                    dragStart.current.y +
                    ((event.clientY - dragStart.current.clientY) /
                      Math.max(rect.height, 1)) *
                      drawingHeight,
                });
              }}
              onPointerUp={(event) => {
                dragStart.current = null;
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => {
                dragStart.current = null;
              }}
            />
            <p>Drag the photo to crop it inside the frame.</p>
          </div>
          <div className={styles.controls}>
            <label htmlFor="photo-zoom">Zoom</label>
            <input
              id="photo-zoom"
              type="range"
              min="1"
              max="3"
              step="0.05"
              value={zoom}
              onChange={(event) => setZoom(Number(event.currentTarget.value))}
              disabled={disabled}
            />
            <div className={styles.actions}>
              <button
                type="button"
                onClick={() => {
                  setRotation((current) => (current + 90) % 360);
                  setOffset({ x: 0, y: 0 });
                }}
                disabled={disabled}
              >
                Rotate 90°
              </button>
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={disabled}
              >
                Change photo
              </button>
            </div>
          </div>
          {previewUrl && (
            <div className={styles.preview}>
              <h3>Edited photo preview</h3>
              <img src={previewUrl} alt="Edited autograph photo preview" />
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </section>
  );
}
