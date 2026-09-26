import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { runWorker } from './worker';

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
});
