import { Readable } from 'node:stream';
import { PrivateObjectTooLargeError } from '@digital-autograph/autographs';

export const privateObjectReadTimeoutMs = 30_000;

export async function readPrivateObject(
  load: (signal: AbortSignal) => Promise<{ Body?: unknown }>,
  maxBytes: number,
  timeoutMs = privateObjectReadTimeoutMs,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new Error('Invalid private object byte limit');
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > privateObjectReadTimeoutMs
  )
    throw new Error('Invalid private object read deadline');
  const controller = new AbortController();
  let body: Readable | undefined;
  const disposeBody = () => {
    try {
      body?.destroy();
    } catch {
      return;
    }
  };
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      reject(controller.signal.reason);
      disposeBody();
    };
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException('Private object read timed out', 'TimeoutError'),
      ),
    timeoutMs,
  );
  const operation = (async () => {
    const result = await load(controller.signal);
    if (result.Body instanceof Readable) {
      body = result.Body;
      body.on('error', () => {});
    }
    if (controller.signal.aborted) {
      disposeBody();
      controller.signal.throwIfAborted();
    }
    if (!body) throw new Error('Private object has no Node readable body');
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of body) {
        controller.signal.throwIfAborted();
        if (!(chunk instanceof Uint8Array))
          throw new Error('Invalid private object body chunk');
        size += chunk.byteLength;
        if (size > maxBytes)
          throw new PrivateObjectTooLargeError(
            'Private object exceeds byte limit',
          );
        chunks.push(Buffer.from(chunk));
      }
      controller.signal.throwIfAborted();
      return Buffer.concat(chunks, size);
    } finally {
      disposeBody();
    }
  })();
  try {
    return await Promise.race([operation, aborted]);
  } catch (error) {
    controller.abort(error);
    throw error;
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', onAbort);
  }
}
