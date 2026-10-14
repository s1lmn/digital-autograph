import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWorker, type WorkerOperations } from './worker';

describe('worker lifecycle', () => {
  afterEach(() => vi.restoreAllMocks());
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
    const cleanupOAuthAttempts = vi.fn(async () => 0);
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
        cleanupOAuthAttempts,
      },
    );
    await started;
    signals.emit('SIGTERM');
    expect(close).not.toHaveBeenCalled();
    release?.();
    await running;
    expect(claim).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledOnce();
    expect(cleanupOAuthAttempts).not.toHaveBeenCalled();
  });

  it('paces OAuth cleanup after failure while image and notification polling continue', async () => {
    const signals = new EventEmitter();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    let cycles = 0;
    const claim = vi.fn(async () => {
      cycles++;
      if (cycles === 2) now = 59_999;
      if (cycles === 3) now = 60_000;
      return null;
    });
    const cleanupOAuthAttempts = vi
      .fn()
      .mockRejectedValueOnce(new Error('synthetic-secret-canary'))
      .mockImplementationOnce(async () => {
        signals.emit('SIGTERM');
        return 0;
      });
    const notifications = vi.fn(async () => {});
    await runWorker(
      { checkConnection: async () => {}, close: async () => {} },
      signals,
      () => {},
      {
        repository: {
          claim,
          cleanupAbandoned: async () => false,
        } as unknown as WorkerOperations['repository'],
        storage: {} as WorkerOperations['storage'],
        leaseSeconds: 60,
        pollIntervalMs: 1,
        cleanupGraceSeconds: 60,
        cleanupOAuthAttempts,
        notifications,
      },
    );
    expect(claim).toHaveBeenCalledTimes(3);
    expect(notifications).toHaveBeenCalledTimes(3);
    expect(cleanupOAuthAttempts).toHaveBeenCalledTimes(2);
    expect(errorLog.mock.calls).toEqual([
      [JSON.stringify({ event: 'OAUTH_ATTEMPT_CLEANUP_FAILED' })],
    ]);
  });

  it('finishes in-flight OAuth cleanup before closing the pool on SIGTERM', async () => {
    const signals = new EventEmitter();
    let release: (() => void) | undefined;
    let enter: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const cleanupOAuthAttempts = vi.fn(async () => {
      enter?.();
      await gate;
      return 2;
    });
    const infoLog = vi.spyOn(console, 'info').mockImplementation(() => {});
    const close = vi.fn(async () => {});
    const running = runWorker(
      { checkConnection: async () => {}, close },
      signals,
      () => {},
      {
        repository: {
          claim: async () => null,
          cleanupAbandoned: async () => false,
        } as unknown as WorkerOperations['repository'],
        storage: {} as WorkerOperations['storage'],
        leaseSeconds: 60,
        pollIntervalMs: 1,
        cleanupGraceSeconds: 60,
        cleanupOAuthAttempts,
      },
    );
    await started;
    signals.emit('SIGTERM');
    expect(close).not.toHaveBeenCalled();
    release?.();
    await running;
    expect(cleanupOAuthAttempts).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(infoLog.mock.calls).toEqual([
      [JSON.stringify({ event: 'OAUTH_ATTEMPTS_CLEANED', deletedAttempts: 2 })],
    ]);
  });
});
