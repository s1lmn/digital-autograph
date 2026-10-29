import { afterEach, describe, expect, it, vi } from 'vitest';
import { privateObjectOperation } from './private-object-operation';

afterEach(() => vi.useRealTimers());
describe('private mutation/HEAD deadline', () => {
  it('rejects an ignored abort without waiting for credentials or middleware', async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    const pending = privateObjectOperation((value) => {
      signal = value;
      return new Promise(() => {});
    });
    const failed = expect(pending).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await failed;
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('passes cancellation to transport and consumes late rejection', async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    let reject!: (error: Error) => void;
    let signal!: AbortSignal;
    const pending = privateObjectOperation((value) => {
      signal = value;
      return new Promise((_, fail) => {
        reject = fail;
      });
    }, caller.signal);
    const failed = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.advanceTimersByTimeAsync(0);
    caller.abort();
    await failed;
    expect(signal.aborted).toBe(true);
    reject(new Error('late private provider failure'));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not start an already canceled operation', async () => {
    const caller = new AbortController();
    caller.abort();
    const action = vi.fn();
    await expect(
      privateObjectOperation(action, caller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(action).not.toHaveBeenCalled();
  });
  it('returns success and preserves an ordinary provider failure', async () => {
    vi.useFakeTimers();
    expect(await privateObjectOperation(async () => 7)).toBe(7);
    const error = new Error('provider fixture');
    await expect(
      privateObjectOperation(async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([0, -1, NaN, Infinity, 10001])(
    'rejects invalid deadline %s',
    async (timeout) => {
      await expect(
        privateObjectOperation(async () => true, undefined, timeout),
      ).rejects.toThrow('Invalid private storage deadline');
    },
  );
});
