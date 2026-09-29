'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './photo-upload-editor.module.css';

type PhotoUploadEditorProps = {
  onPhotoChange: (blob: Blob | null) => void;
  disabled?: boolean;
};

export function PhotoUploadEditor({
  onPhotoChange,
  disabled = false,
}: PhotoUploadEditorProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [rotation, setRotation] = useState<number>(0); // 0, 90, 180, 270
  const [zoom, setZoom] = useState<number>(1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loadedImageRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Очистка при смене фото
  const handleFile = (file?: File) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(reader.result as string);
      setRotation(0);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    reader.readAsDataURL(file);
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    handleFile(file);
    e.target.value = '';
  };

  // Загрузка Image объекта
  useEffect(() => {
    if (!imageSrc) {
      loadedImageRef.current = null;
      onPhotoChange(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      loadedImageRef.current = img;
      renderCropped();
    };
    img.src = imageSrc;
  }, [imageSrc]);

  // Отрисовка на canvas с учетом поворота, зума и смещения
  const renderCropped = useCallback(() => {
    const canvas = canvasRef.current;
    const img = loadedImageRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Фиксированный размер целевого холста для автографа
    const targetWidth = 600;
    const targetHeight = 300;
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    ctx.clearRect(0, 0, targetWidth, targetHeight);
    ctx.save();

    // 1. Центрируем
    ctx.translate(targetWidth / 2 + offset.x, targetHeight / 2 + offset.y);
    // 2. Поворот
    ctx.rotate((rotation * Math.PI) / 180);
    // 3. Зум
    ctx.scale(zoom, zoom);

    // Подгоняем начальный масштаб по размеру
    const isRotated90or270 = rotation % 180 !== 0;
    const naturalW = isRotated90or270 ? img.height : img.width;
    const naturalH = isRotated90or270 ? img.width : img.height;
    const baseScale = Math.max(targetWidth / naturalW, targetHeight / naturalH);

    const drawW = img.width * baseScale;
    const drawH = img.height * baseScale;

    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    // Генерируем PNG Blob для отправки
    canvas.toBlob((blob) => {
      onPhotoChange(blob);
    }, 'image/png');
  }, [rotation, zoom, offset, onPhotoChange]);

  useEffect(() => {
    if (loadedImageRef.current) {
      renderCropped();
    }
  }, [renderCropped]);

  // Управление жестами панорамирования (Pointer Events для мыши и тачскрина)
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || !imageSrc) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    setOffset({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    setIsDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const rotateClockwise = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const resetAdjustments = () => {
    setRotation(0);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  return (
    <section aria-labelledby="photo-upload-heading" className={styles.container}>
      <div className={styles.header}>
        <div>
          <h2 id="photo-upload-heading">Upload autograph photo</h2>
          <p>
            Take a picture of your paper signature or upload an existing photo.
            The photo stays private while you edit.
          </p>
        </div>
      </div>

      {!imageSrc ? (
        <div className={styles.uploadBox}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className={styles.hiddenInput}
            onChange={onFileInputChange}
            disabled={disabled}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className={styles.hiddenInput}
            onChange={onFileInputChange}
            disabled={disabled}
          />
          <div className={styles.buttonGroup}>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => cameraInputRef.current?.click()}
              disabled={disabled}
            >
              📷 Take Photo
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
            >
              📁 Choose from Gallery
            </button>
          </div>
          <p className={styles.hint}>
            Tips: Good lighting, flat surface, dark ink on white paper.
          </p>
        </div>
      ) : (
        <div className={styles.cropSection}>
          <div className={styles.canvasWrapper}>
            <canvas
              ref={canvasRef}
              className={styles.canvas}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
            <div className={styles.cropOverlayHint}>
              Drag to pan • Use zoom slider below
            </div>
          </div>

          <div className={styles.controls}>
            <div className={styles.zoomControl}>
              <label htmlFor="zoom-slider">Zoom:</label>
              <input
                id="zoom-slider"
                type="range"
                min="0.5"
                max="3"
                step="0.05"
                value={zoom}
                disabled={disabled}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
              />
            </div>

            <div className={styles.actionButtons}>
              <button
                type="button"
                onClick={rotateClockwise}
                disabled={disabled}
              >
                ⟳ Rotate 90°
              </button>
              <button
                type="button"
                onClick={resetAdjustments}
                disabled={disabled}
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => setImageSrc(null)}
                disabled={disabled}
              >
                Change Photo
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}