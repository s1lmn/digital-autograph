import { PassThrough, Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrivateObjectTooLargeError } from '@digital-autograph/autographs';
import {
  privateObjectReadTimeoutMs,
  readPrivateObject,
} from './private-object-read';

afterEach(() => vi.useRealTimers());

describe('bounded private object reads', () => {
  it('accepts complete empty and exact-limit Node streams and clears the deadline', async () => {
    vi.useFakeTimers();
    for (const chunks of [[], [Buffer.from('ab'), Buffer.from('cd')]]) {
      const body = Readable.from(chunks);
      const bytes = await readPrivateObject(async () => ({ Body: body }), 4);
      expect(bytes).toEqual(Buffer.concat(chunks));
      expect(body.destroyed).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it('enforces actual bytes, aborts excess data and preserves the permanent size error', async () => {
    const body = Readable.from([Buffer.from('abc'), Buffer.from('de')]);
    let signal: AbortSignal | undefined;
    await expect(
      readPrivateObject(async (value) => {
        signal = value;
        return { Body: body };
      }, 4),
    ).rejects.toBeInstanceOf(PrivateObjectTooLargeError);
    expect(signal?.aborted).toBe(true);
    expect(body.destroyed).toBe(true);
  });

  it('bounds a provider that never returns headers, even if it ignores abort', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const result = readPrivateObject((value) => {
      signal = value;
      return new Promise(() => {});
    }, 4).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(privateObjectReadTimeoutMs - 1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({ name: 'TimeoutError' });
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('destroys a response arriving after the deadline and handles its late error', async () => {
    vi.useFakeTimers();
    let finish!: (result: { Body: Readable }) => void;
    const pending = new Promise<{ Body: Readable }>((resolve) => {
      finish = resolve;
    });
    const result = readPrivateObject(() => pending, 4).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(privateObjectReadTimeoutMs);
    expect(await result).toMatchObject({ name: 'TimeoutError' });
    const body = new PassThrough();
    finish({ Body: body });
    await vi.advanceTimersByTimeAsync(0);
    expect(body.destroyed).toBe(true);
    expect(() =>
      body.emit('error', new Error('late private provider error')),
    ).not.toThrow();
  });

  it('does not renew the total deadline when partial bytes keep arriving', async () => {
    vi.useFakeTimers();
    const body = new PassThrough();
    const result = readPrivateObject(async () => ({ Body: body }), 100).catch(
      (error: unknown) => error,
    );
    for (let i = 0; i < 3; i++) {
      body.write(Buffer.from('x'));
      await vi.advanceTimersByTimeAsync(9000);
      expect(body.destroyed).toBe(false);
    }
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toMatchObject({ name: 'TimeoutError' });
    expect(body.destroyed).toBe(true);
  });

  it('charges header latency against the same body-read budget', async () => {
    vi.useFakeTimers();
    let finish!: (response: { Body: Readable }) => void;
    const pending = new Promise<{ Body: Readable }>((resolve) => {
      finish = resolve;
    });
    const result = readPrivateObject(() => pending, 4).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(20_000);
    const body = new PassThrough();
    finish({ Body: body });
    body.write(Buffer.from('a'));
    await vi.advanceTimersByTimeAsync(9999);
    expect(body.destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({ name: 'TimeoutError' });
    expect(body.destroyed).toBe(true);
  });

  it('rejects on time without awaiting a broken stream destroy callback', async () => {
    vi.useFakeTimers();
    const body = new Readable({ read() {}, destroy() {} });
    const result = readPrivateObject(async () => ({ Body: body }), 4).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(privateObjectReadTimeoutMs);
    expect(await result).toMatchObject({ name: 'TimeoutError' });
    expect(body.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a throwing destroy callback from escaping deadline handling', async () => {
    vi.useFakeTimers();
    const body = new Readable({
      read() {},
      destroy() {
        throw new Error('private cleanup detail');
      },
    });
    const result = readPrivateObject(async () => ({ Body: body }), 4).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(privateObjectReadTimeoutMs);
    expect(await result).toMatchObject({ name: 'TimeoutError' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves provider errors and clears the pending deadline', async () => {
    vi.useFakeTimers();
    const error = Object.assign(new Error('private provider detail'), {
      $metadata: { httpStatusCode: 404 },
    });
    await expect(
      readPrivateObject(async () => {
        throw error;
      }, 4),
    ).rejects.toBe(error);
    expect(vi.getTimerCount()).toBe(0);
    const body = new PassThrough();
    const result = readPrivateObject(async () => ({ Body: body }), 4);
    const assertion = expect(result).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(0);
    body.destroy(error);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([undefined, {}, Readable.from([{ secret: 'private object' }])])(
    'fails closed on an invalid body: %#',
    async (body) => {
      await expect(
        readPrivateObject(async () => ({ Body: body }), 4),
      ).rejects.toThrow();
    },
  );

  it.each([0, -1, 1.5, Infinity, NaN])(
    'rejects an invalid byte limit before storage work: %s',
    async (maxBytes) => {
      const load = vi.fn();
      await expect(readPrivateObject(load, maxBytes)).rejects.toThrow(
        'Invalid private object byte limit',
      );
      expect(load).not.toHaveBeenCalled();
    },
  );

  it.each([0, -1, 1.5, Infinity, privateObjectReadTimeoutMs + 1])(
    'rejects an invalid deadline before storage work: %s',
    async (timeoutMs) => {
      const load = vi.fn();
      await expect(readPrivateObject(load, 4, timeoutMs)).rejects.toThrow(
        'Invalid private object read deadline',
      );
      expect(load).not.toHaveBeenCalled();
    },
  );
});
