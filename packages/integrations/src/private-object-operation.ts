// The SDK signal alone is insufficient when credentials/middleware ignore abort.
// A timed-out mutation remains UNKNOWN and is reconciled by its immutable key.
export const privateObjectOperationTimeoutMs = 10_000;

export async function privateObjectOperation<T>(
  action: (signal: AbortSignal) => Promise<T>,
  caller?: AbortSignal,
  timeoutMs = privateObjectOperationTimeoutMs,
): Promise<T> {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > privateObjectOperationTimeoutMs
  )
    throw new Error('Invalid private storage deadline');
  const controller = new AbortController();
  const signal = caller
    ? AbortSignal.any([caller, controller.signal])
    : controller.signal;
  let rejectAbort!: (error: unknown) => void;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const abort = () => rejectAbort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException('Private storage operation timed out', 'TimeoutError'),
      ),
    timeoutMs,
  );
  try {
    signal.throwIfAborted();
    return await Promise.race([
      Promise.resolve().then(() => {
        signal.throwIfAborted();
        return action(signal);
      }),
      aborted,
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
