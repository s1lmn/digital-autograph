import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  processOneAutographJob,
  runWorker,
  type WorkerOperations,
} from './worker';

const jobId = 'f1111111-1111-4111-8111-111111111111';
const canary = 'private-storage-key-and-cookie-canary';
const failure = () =>
  Object.assign(new Error(canary), { code: 'ECONNRESET', privateUrl: canary });

function operations(
  overrides: Partial<WorkerOperations> = {},
): WorkerOperations {
  return {
    repository: {
      claim: async () => null,
      cleanupAbandoned: async () => false,
    } as unknown as WorkerOperations['repository'],
    storage: {} as WorkerOperations['storage'],
    leaseSeconds: 60,
    pollIntervalMs: 1,
    cleanupGraceSeconds: 60,
    ...overrides,
  };
}

describe('structured diagnostics in real worker failure paths', () => {
  afterEach(() => vi.restoreAllMocks());

  it('continues image/notification work after failures and closes normally', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const signals = new EventEmitter();
    let cycles = 0;
    const claim = vi.fn(async () => {
      if (++cycles === 1) throw failure();
      return null;
    });
    const notifications = vi.fn(async () => {
      if (cycles === 1) throw failure();
      signals.emit('SIGTERM');
    });
    const close = vi.fn(async () => {});
    await runWorker(
      { checkConnection: async () => {}, close },
      signals,
      () => {},
      operations({
        repository: {
          claim,
          cleanupAbandoned: async () => false,
        } as unknown as WorkerOperations['repository'],
        notifications,
      }),
    );
    expect(claim).toHaveBeenCalledTimes(2);
    expect(notifications).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
    expect(signals.listenerCount('SIGTERM')).toBe(0);
    const records = log.mock.calls.map(([line]) => JSON.parse(line));
    expect(records.map((record) => record.event)).toEqual([
      'WORKER_POLL_FAILED',
      'NOTIFICATION_POLL_FAILED',
    ]);
    for (const record of records)
      expect(record).toMatchObject({
        runtime: 'worker',
        level: 50,
        err: { name: 'Error', code: 'ECONNRESET' },
      });
    expect(JSON.stringify(records)).not.toContain(canary);
  });

  it.each(['connection', 'deadline'])(
    'records %s storage failure safely with the same failure/lease arguments',
    async (kind) => {
      const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const fail = vi.fn(async () => {});
      const job = { id: jobId, originalKey: canary, autographId: jobId };
      const repository = {
        claim: async () => job,
        fail,
      } as unknown as WorkerOperations['repository'];
      const getPrivateObject = vi.fn(async () => {
        throw kind === 'deadline'
          ? new DOMException('Private object read timed out', 'TimeoutError')
          : failure();
      });
      expect(
        await processOneAutographJob(
          operations({
            repository,
            storage: {
              getPrivateObject,
            } as unknown as WorkerOperations['storage'],
          }),
        ),
      ).toBe(true);
      expect(fail).toHaveBeenCalledWith(job, 'STORAGE_FAILURE', false, 60);
      expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({
        event: 'AUTOGRAPH_PROCESSING_FAILED',
        level: 40,
        jobId,
        reason: 'STORAGE_FAILURE',
        err:
          kind === 'deadline'
            ? { name: 'TimeoutError' }
            : { code: 'ECONNRESET' },
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain(canary);
    },
  );

  it('preserves partial-PUT cleanup and failure recording even when both fail', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bytes = await sharp({
      create: {
        width: 24,
        height: 24,
        channels: 4,
        background: { r: 10, g: 20, b: 30, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const job = {
      id: jobId,
      originalKey: canary,
      autographId: jobId,
      source: 'canvas',
      expectedContentType: 'image/png',
    };
    const cleanupPartial = vi.fn(async () => {
      throw failure();
    });
    const fail = vi.fn(async () => {
      throw failure();
    });
    const succeed = vi.fn();
    const repository = {
      claim: async () => job,
      cleanupPartial,
      fail,
      succeed,
    } as unknown as WorkerOperations['repository'];
    await processOneAutographJob(
      operations({
        repository,
        storage: {
          getPrivateObject: async () => bytes,
          putPrivateObject: async () => {
            throw failure();
          },
        } as unknown as WorkerOperations['storage'],
      }),
    );
    expect(cleanupPartial).toHaveBeenCalledWith(job, 60, expect.any(Function));
    expect(fail).toHaveBeenCalledWith(job, 'STORAGE_FAILURE', false, 60);
    expect(succeed).not.toHaveBeenCalled();
    const warnings = warn.mock.calls.map(([line]) => JSON.parse(line));
    expect(warnings.map((record) => record.event)).toEqual([
      'AUTOGRAPH_PARTIAL_CLEANUP_FAILED',
      'AUTOGRAPH_PROCESSING_FAILED',
    ]);
    expect(JSON.parse(error.mock.calls[0]![0])).toMatchObject({
      event: 'AUTOGRAPH_FAILURE_RECORD_FAILED',
      level: 50,
      jobId,
      err: { code: 'ECONNRESET' },
    });
    expect(JSON.stringify([warn.mock.calls, error.mock.calls])).not.toContain(
      canary,
    );
  });

  it('keeps malformed images permanent and records the finite reason', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const job = {
      id: jobId,
      originalKey: canary,
      autographId: jobId,
      source: 'canvas',
      expectedContentType: 'image/png',
    };
    const fail = vi.fn(async () => {});
    const putPrivateObject = vi.fn();
    await processOneAutographJob(
      operations({
        repository: {
          claim: async () => job,
          fail,
        } as unknown as WorkerOperations['repository'],
        storage: {
          getPrivateObject: async () => Buffer.from('invalid image'),
          putPrivateObject,
        } as unknown as WorkerOperations['storage'],
      }),
    );
    expect(fail).toHaveBeenCalledWith(job, 'INVALID_IMAGE', true, 60);
    expect(putPrivateObject).not.toHaveBeenCalled();
    expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({
      event: 'AUTOGRAPH_PROCESSING_FAILED',
      reason: 'INVALID_IMAGE',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(canary);
  });

  it('retains the uploaded object after DB failure so the existing retry can adopt it', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bytes = await sharp({
      create: {
        width: 24,
        height: 24,
        channels: 4,
        background: { r: 10, g: 20, b: 30, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const job = {
      id: jobId,
      originalKey: canary,
      autographId: jobId,
      source: 'canvas',
      expectedContentType: 'image/png',
    };
    const fail = vi.fn(async () => {});
    const cleanupPartial = vi.fn();
    const deleteObject = vi.fn();
    await processOneAutographJob(
      operations({
        repository: {
          claim: async () => job,
          succeed: async () => {
            throw failure();
          },
          fail,
          cleanupPartial,
        } as unknown as WorkerOperations['repository'],
        storage: {
          getPrivateObject: async () => bytes,
          putPrivateObject: async () => {},
          deleteObject,
        } as unknown as WorkerOperations['storage'],
      }),
    );
    expect(fail).toHaveBeenCalledWith(job, 'PROCESSING_FAILURE', false, 60);
    expect(cleanupPartial).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
    expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({
      event: 'AUTOGRAPH_PROCESSING_FAILED',
      reason: 'PROCESSING_FAILURE',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(canary);
  });
});
