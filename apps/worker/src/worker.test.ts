import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { runWorker, type WorkerOperations } from './worker';

describe('worker lifecycle', () => {
  it('checks PostgreSQL and closes its pool after SIGTERM', async () => {
    const signals = new EventEmitter();
    const checkConnection = vi.fn(async () => {});
    const close = vi.fn(async () => {});

    await runWorker({ checkConnection, close }, signals, () => {
      signals.emit('SIGTERM');
    });

    expect(checkConnection).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(signals.listenerCount('SIGINT')).toBe(0);
  });

  it('finishes the current cleanup before shutdown and stops polling', async () => {
    const signals = new EventEmitter();
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const claim = vi.fn(async () => null);
    const cleanupAbandoned = vi.fn(async () => {
      entered?.();
      await gate;
      return true;
    });
    const close = vi.fn(async () => {});
    const running = runWorker(
      { checkConnection: async () => {}, close },
      signals,
      () => {},
      {
        repository: {
          claim,
          cleanupAbandoned,
        } as unknown as WorkerOperations['repository'],
        storage: {} as WorkerOperations['storage'],
        leaseSeconds: 60,
        pollIntervalMs: 250,
        cleanupGraceSeconds: 60,
      },
    );
    await started;
    signals.emit('SIGTERM');
    expect(close).not.toHaveBeenCalled();
    release?.();
    await running;
    expect(claim).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledOnce();
  });
});
