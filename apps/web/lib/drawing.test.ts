import { describe, expect, it } from 'vitest';
import { drawingBounds, hasDrawing, pointFromPointer } from './drawing';

describe('canvas drawing model', () => {
  it('normalizes pointer coordinates and clamps pressure', () => {
    expect(
      pointFromPointer(
        { clientX: 110, clientY: 70, pointerType: 'pen', pressure: 0.1 },
        { left: 10, top: 20, width: 200, height: 100 },
      ),
    ).toEqual({ x: 600, y: 300, pressure: 0.25 });
  });

  it('does not submit empty marks and bounds a meaningful stroke', () => {
    const tap = [{ points: [{ x: 100, y: 100, pressure: 0.65 }] }];
    expect(hasDrawing(tap)).toBe(false);
    const stroke = [
      { points: [tap[0]!.points[0]!, { x: 160, y: 140, pressure: 0.65 }] },
    ];
    expect(hasDrawing(stroke)).toBe(true);
    expect(drawingBounds(stroke)).toEqual({
      left: 76,
      top: 76,
      width: 108,
      height: 88,
    });
  });
});
