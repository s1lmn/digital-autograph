'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  drawStrokes,
  drawingHeight,
  drawingWidth,
  hasDrawing,
  pointFromPointer,
  type Point,
  type Stroke,
} from '../lib/drawing';
import styles from './canvas-editor.module.css';

type CanvasEditorProps = {
  onDrawingChange: (hasMarks: boolean) => void;
  onStrokesChange: (strokes: readonly Stroke[]) => void;
  disabled?: boolean;
};

export function CanvasEditor({
  onDrawingChange,
  onStrokesChange,
  disabled = false,
}: CanvasEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const activePointerRef = useRef<number | null>(null);
  const keyboardPointRef = useRef<Point>({
    x: drawingWidth / 2,
    y: drawingHeight / 2,
    pressure: 0.65,
  });
  const keyboardDrawingRef = useRef(false);
  const [strokeCount, setStrokeCount] = useState(0);
  const [message, setMessage] = useState('Drawing area ready.');

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.setTransform(
      width / drawingWidth,
      0,
      0,
      height / drawingHeight,
      0,
      0,
    );
    context.clearRect(0, 0, drawingWidth, drawingHeight);
    drawStrokes(context, strokesRef.current);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(redraw);
    observer.observe(canvas);
    redraw();
    return () => observer.disconnect();
  }, [redraw]);

  const publish = useCallback(
    (announcement: string) => {
      setStrokeCount(strokesRef.current.length);
      onDrawingChange(hasDrawing(strokesRef.current));
      onStrokesChange(
        strokesRef.current.map(({ points }) => ({ points: [...points] })),
      );
      setMessage(announcement);
      redraw();
    },
    [onDrawingChange, onStrokesChange, redraw],
  );

  const appendPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = strokesRef.current.at(-1);
    if (!stroke) return;
    const point: Point = pointFromPointer(
      event.nativeEvent,
      event.currentTarget.getBoundingClientRect(),
    );
    const previous = stroke.points.at(-1);
    if (
      previous &&
      Math.hypot(point.x - previous.x, point.y - previous.y) < 1.5
    )
      return;
    stroke.points.push(point);
    redraw();
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || activePointerRef.current !== null) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    activePointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    strokesRef.current.push({ points: [] });
    appendPoint(event);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerId !== activePointerRef.current) return;
    event.preventDefault();
    appendPoint(event);
  };

  const finishPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerId !== activePointerRef.current) return;
    event.preventDefault();
    if (event.type === 'pointerup') appendPoint(event);
    activePointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    publish('Stroke added.');
  };

  const undo = () => {
    strokesRef.current.pop();
    publish('Last stroke removed.');
  };

  const clear = () => {
    strokesRef.current = [];
    publish('Drawing cleared.');
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      keyboardDrawingRef.current = !keyboardDrawingRef.current;
      if (keyboardDrawingRef.current) {
        strokesRef.current.push({ points: [{ ...keyboardPointRef.current }] });
        setMessage('Keyboard pen down. Use arrow keys to draw.');
      } else {
        publish('Keyboard stroke added.');
      }
      return;
    }
    if (event.key === 'Escape' && keyboardDrawingRef.current) {
      keyboardDrawingRef.current = false;
      publish('Keyboard stroke added.');
      return;
    }
    const step = event.shiftKey ? 2 : 12;
    const movement: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = movement[event.key];
    if (!delta) return;
    event.preventDefault();
    const previous = keyboardPointRef.current;
    const next = {
      x: Math.min(drawingWidth, Math.max(0, previous.x + delta[0]!)),
      y: Math.min(drawingHeight, Math.max(0, previous.y + delta[1]!)),
      pressure: 0.65,
    };
    keyboardPointRef.current = next;
    if (keyboardDrawingRef.current) {
      strokesRef.current.at(-1)?.points.push(next);
      redraw();
    }
  };

  return (
    <section aria-labelledby="drawing-heading" className={styles.editor}>
      <div className={styles.header}>
        <div>
          <h2 id="drawing-heading">Draw your autograph</h2>
          <p>
            Use your finger, mouse, or stylus. The canvas stays private while
            you edit.
          </p>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            onClick={undo}
            disabled={disabled || strokeCount === 0}
          >
            Undo
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={disabled || strokeCount === 0}
          >
            Clear
          </button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        aria-label="Autograph drawing area"
        aria-describedby="drawing-help"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onLostPointerCapture={(event) => {
          if (activePointerRef.current === event.pointerId)
            finishPointer(event);
        }}
      />
      <p id="drawing-help" className={styles.help}>
        Draw inside the bordered area. Keyboard: focus the canvas, press Space
        to lower or lift the pen, and use arrow keys to move; hold Shift for
        smaller steps. Use Undo or Clear to correct your drawing.
      </p>
      <p className={styles.srOnly} role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
