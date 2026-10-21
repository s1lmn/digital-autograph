import { describe, expect, it } from 'vitest';
import { workerFailureRecord } from './logging';

const jobId = 'f1111111-1111-4111-8111-111111111111';
const canary = 'private-original-and-signed-url-canary';

describe('worker diagnostic privacy boundary', () => {
  it('retains only bounded correlation/reason and existing safe error metadata', () => {
    const error = Object.assign(
      new Error(canary, { cause: new Error(canary) }),
      {
        code: 'ECONNREFUSED',
        statusCode: 503,
        storageKey: canary,
        toJSON() {
          throw new Error(canary);
        },
      },
    );
    const record = workerFailureRecord('AUTOGRAPH_PROCESSING_FAILED', error, {
      jobId,
      reason: 'STORAGE_FAILURE',
    });
    expect(record).toEqual({
      level: 40,
      time: expect.any(String),
      runtime: 'worker',
      event: 'AUTOGRAPH_PROCESSING_FAILED',
      msg: 'Autograph processing attempt failed',
      err: { name: 'Error', code: 'ECONNREFUSED', statusCode: 503 },
      jobId,
      reason: 'STORAGE_FAILURE',
    });
    expect(Number.isNaN(Date.parse(record.time))).toBe(false);
    expect(JSON.stringify(record)).not.toContain(canary);
  });

  it.each([
    null,
    canary,
    { name: canary, code: canary, message: canary },
    Object.defineProperty({}, 'name', {
      get() {
        throw new Error(canary);
      },
    }),
    new Proxy(
      {},
      {
        get() {
          throw new Error(canary);
        },
      },
    ),
  ])('fails closed on unknown/hostile exceptions: %#', (error) => {
    const record = workerFailureRecord('WORKER_POLL_FAILED', error, {
      jobId: canary,
      reason: canary,
    });
    expect(record.err).toEqual({ name: 'UnknownError' });
    expect(record).not.toHaveProperty('jobId');
    expect(record).not.toHaveProperty('reason');
    expect(JSON.stringify(record)).not.toContain(canary);
  });

  it('does not invoke an error toJSON or hostile context while logging', () => {
    const error = {
      name: 'Error',
      toJSON() {
        throw new Error(canary);
      },
    };
    const context = new Proxy(
      {},
      {
        get() {
          throw new Error(canary);
        },
      },
    );
    expect(() =>
      JSON.stringify(
        workerFailureRecord('NOTIFICATION_POLL_FAILED', error, context),
      ),
    ).not.toThrow();
  });
});
