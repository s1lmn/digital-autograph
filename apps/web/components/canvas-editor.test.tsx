// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CanvasEditor } from './canvas-editor';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CanvasEditor', () => {
  it('offers accessible editing actions and reports a drawn stroke', () => {
    const context = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
    HTMLCanvasElement.prototype.hasPointerCapture = vi.fn(() => true);
    HTMLCanvasElement.prototype.releasePointerCapture = vi.fn();
    vi.spyOn(
      HTMLCanvasElement.prototype,
      'getBoundingClientRect',
    ).mockReturnValue({ left: 0, top: 0, width: 600, height: 300 } as DOMRect);
    const onDrawingChange = vi.fn();
    render(
      <CanvasEditor
        onDrawingChange={onDrawingChange}
        onStrokesChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled'),
    ).toBe(true);
    const canvas = screen.getByLabelText('Autograph drawing area');
    fireEvent.pointerDown(canvas, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 80,
      clientY: 80,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 100,
      clientY: 100,
    });
    expect(onDrawingChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onDrawingChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('status').textContent).toBe('Last stroke removed.');
    fireEvent.keyDown(canvas, { key: ' ' });
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    fireEvent.keyDown(canvas, { key: ' ' });
    expect(onDrawingChange).toHaveBeenLastCalledWith(true);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});

it('redraws and keeps keyboard drawing available when ResizeObserver is absent', () => {
  vi.stubGlobal('ResizeObserver', undefined);
  const context = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  const changed = vi.fn();
  render(<CanvasEditor onDrawingChange={changed} onStrokesChange={vi.fn()} />);
  const before = context.clearRect.mock.calls.length;
  fireEvent(window, new Event('resize'));
  expect(context.clearRect.mock.calls.length).toBeGreaterThan(before);
  const canvas = screen.getByLabelText('Autograph drawing area');
  fireEvent.keyDown(canvas, { key: ' ' });
  fireEvent.keyDown(canvas, { key: 'ArrowRight' });
  fireEvent.keyDown(canvas, { key: ' ' });
  expect(changed).toHaveBeenLastCalledWith(true);
});
