export const drawingWidth = 1200;
export const drawingHeight = 600;
export const maxCanvasUploadBytes = 10 * 1024 * 1024;

export type Point = { x: number; y: number; pressure: number };
export type Stroke = { points: Point[] };

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

export function pointFromPointer(
  input: Pick<PointerEvent, 'clientX' | 'clientY' | 'pressure' | 'pointerType'>,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
): Point {
  const pressure =
    input.pointerType === 'pen' && input.pressure > 0
      ? clamp(input.pressure, 0.25, 1)
      : 0.65;
  return {
    x: clamp(
      ((input.clientX - rect.left) / rect.width) * drawingWidth,
      0,
      drawingWidth,
    ),
    y: clamp(
      ((input.clientY - rect.top) / rect.height) * drawingHeight,
      0,
      drawingHeight,
    ),
    pressure,
  };
}

export function hasDrawing(strokes: readonly Stroke[]): boolean {
  return strokes.some(({ points }) => {
    if (points.length < 2) return false;
    let distance = 0;
    for (let index = 1; index < points.length; index++) {
      const previous = points[index - 1]!;
      const current = points[index]!;
      distance += Math.hypot(current.x - previous.x, current.y - previous.y);
    }
    return distance >= 12;
  });
}

export function drawStrokes(
  context: CanvasRenderingContext2D,
  strokes: readonly Stroke[],
): void {
  context.strokeStyle = '#17202a';
  context.fillStyle = '#17202a';
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const { points } of strokes) {
    if (points.length === 0) continue;
    if (points.length === 1) {
      const point = points[0]!;
      context.beginPath();
      context.arc(point.x, point.y, 1.7, 0, Math.PI * 2);
      context.fill();
      continue;
    }
    for (let index = 1; index < points.length; index++) {
      const previous = points[index - 1]!;
      const current = points[index]!;
      context.lineWidth = 2.5 + current.pressure * 2;
      context.beginPath();
      context.moveTo(previous.x, previous.y);
      context.lineTo(current.x, current.y);
      context.stroke();
    }
  }
}

export function drawingBounds(strokes: readonly Stroke[]) {
  let minimumX = drawingWidth;
  let minimumY = drawingHeight;
  let maximumX = 0;
  let maximumY = 0;
  let found = false;
  for (const stroke of strokes) {
    for (const point of stroke.points) {
      found = true;
      minimumX = Math.min(minimumX, point.x);
      minimumY = Math.min(minimumY, point.y);
      maximumX = Math.max(maximumX, point.x);
      maximumY = Math.max(maximumY, point.y);
    }
  }
  if (!found) return null;
  const padding = 24;
  const left = clamp(Math.floor(minimumX - padding), 0, drawingWidth);
  const top = clamp(Math.floor(minimumY - padding), 0, drawingHeight);
  const right = clamp(Math.ceil(maximumX + padding), 0, drawingWidth);
  const bottom = clamp(Math.ceil(maximumY + padding), 0, drawingHeight);
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

export async function exportPng(strokes: readonly Stroke[]): Promise<Blob> {
  if (!hasDrawing(strokes))
    throw new Error('Draw an autograph before continuing.');
  const bounds = drawingBounds(strokes)!;
  const canvas = document.createElement('canvas');
  canvas.width = bounds.width;
  canvas.height = bounds.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable in this browser.');
  context.translate(-bounds.left, -bounds.top);
  drawStrokes(context, strokes);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  );
  if (!blob || blob.type !== 'image/png' || blob.size < 1) {
    throw new Error('Could not create the PNG. Please try again.');
  }
  if (blob.size > maxCanvasUploadBytes) {
    throw new Error('The drawing is too large. Undo a few strokes and retry.');
  }
  return blob;
}
