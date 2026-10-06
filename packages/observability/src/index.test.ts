import { describe, expect, it } from 'vitest';
import {
  runtimeFailureRecord,
  safeErrorDetails,
  safeErrorLogArguments,
} from './index';

const secret = 'synthetic-password-and-private-signed-url';

describe('safe diagnostic boundary', () => {
  it('retains bounded failure metadata while excluding nested payloads and custom serialization', () => {
    const error = Object.assign(
      new Error(secret, { cause: new Error(secret) }),
      {
        code: 'ECONNREFUSED',
        statusCode: 503,
        password: secret,
        query: secret,
        toJSON: () => {
          throw new Error('must not run');
        },
      },
    );
    const result = safeErrorDetails(error);
    expect(result).toEqual({
      name: 'Error',
      code: 'ECONNREFUSED',
      statusCode: 503,
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('retains PostgreSQL codes and storage status without copying driver detail', () => {
    expect(
      safeErrorDetails({
        name: 'DatabaseError',
        code: '23505',
        detail: secret,
      }),
    ).toEqual({ name: 'DatabaseError', code: '23505' });
    expect(
      safeErrorDetails({
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403, requestId: secret },
      }),
    ).toEqual({ name: 'AccessDenied', statusCode: 403 });
  });

  it.each([
    undefined,
    null,
    secret,
    1,
    { name: secret, code: secret },
    { name: 'Error', statusCode: Infinity },
    { name: 'Error', statusCode: 500.1 },
  ])('drops unbounded values: %j', (value) => {
    const serialized = JSON.stringify(safeErrorDetails(value));
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('statusCode');
  });

  it('does not follow cyclic AggregateError causes or inspect nested errors', () => {
    const error = new AggregateError([new Error(secret)], secret);
    error.cause = error;
    expect(safeErrorDetails(error)).toEqual({ name: 'AggregateError' });
  });

  it('fails closed for throwing getters and proxies', () => {
    const value = {
      get name() {
        throw new Error(secret);
      },
    };
    const proxy = new Proxy(
      {},
      {
        get: () => {
          throw new Error(secret);
        },
        has: () => {
          throw new Error(secret);
        },
      },
    );
    expect(safeErrorDetails(value)).toEqual({ name: 'UnknownError' });
    expect(safeErrorDetails(proxy)).toEqual({ name: 'UnknownError' });
    expect(safeErrorLogArguments([proxy])).toEqual([
      { err: { name: 'UnknownError' } },
      'Application error',
    ]);
  });

  it('removes error messages, merged extras and interpolation arguments', () => {
    const error = new Error(secret);
    expect(safeErrorLogArguments([error, secret, secret])).toEqual([
      { err: { name: 'Error' } },
      'Application error',
    ]);
    expect(
      safeErrorLogArguments([
        {
          err: error,
          msg: secret,
          requestBody: secret,
          event: 'API_REQUEST_FAILED',
        },
        '%s',
        secret,
      ]),
    ).toEqual([
      { err: { name: 'Error' }, event: 'API_REQUEST_FAILED' },
      'Application error',
    ]);
    expect(safeErrorLogArguments([{ err: error, event: secret }])[0]).toEqual({
      err: { name: 'Error' },
    });
  });

  it('preserves ordinary logs and JSON startup failure records for either runtime', () => {
    expect(safeErrorLogArguments([{ status: 'ready' }, 'Ready'])).toEqual([
      { status: 'ready' },
      'Ready',
    ]);
    for (const runtime of ['api', 'worker'] as const) {
      const result = runtimeFailureRecord(runtime, new Error(secret));
      expect(result).toMatchObject({
        level: 50,
        runtime,
        event: 'STARTUP_FAILED',
        err: { name: 'Error' },
      });
      expect(Number.isNaN(Date.parse(result.time))).toBe(false);
      expect(JSON.stringify(result)).not.toContain(secret);
    }
  });
});
