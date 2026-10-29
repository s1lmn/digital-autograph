import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from './index';

const canaries = [
  'postgresql://diagnostic_user:synthetic_password@private-host/diagnostic_db',
  'SELECT private_payload FROM private_table',
  'originals/private-storage-key',
  'https://storage.invalid/private?signature=synthetic_signature',
];
const privateData = canaries.join(' ');

afterEach(() => vi.restoreAllMocks());

async function captureIdleError(error: unknown) {
  const output = vi.spyOn(console, 'error').mockImplementation(() => {});
  const database = createDatabase(canaries[0]!);
  try {
    expect(database.pool.listenerCount('error')).toBe(1);
    expect(() => database.pool.emit('error', error)).not.toThrow();
    expect(output).toHaveBeenCalledTimes(1);
    const args = output.mock.calls[0]!;
    expect(args).toHaveLength(1);
    expect(typeof args[0]).toBe('string');
    const record = JSON.parse(args[0] as string);
    expect(record).toEqual({
      level: 50,
      time: expect.any(String),
      event: 'POSTGRES_IDLE_CONNECTION_FAILED',
      err: expect.any(Object),
      msg: 'PostgreSQL idle connection failed',
    });
    expect(Number.isNaN(Date.parse(record.time))).toBe(false);
    for (const canary of canaries) expect(args[0]).not.toContain(canary);
    return record;
  } finally {
    await database.close();
    output.mockRestore();
  }
}

describe('PostgreSQL idle connection diagnostics', () => {
  it.each(['57P01', '08006', 'ECONNRESET'])(
    'preserves the allowed failure code %s without serializing driver detail',
    async (code) => {
      const error = Object.assign(new Error(privateData), {
        name: 'DatabaseError',
        code,
        detail: privateData,
        query: privateData,
        connectionParameters: { password: privateData },
      });
      error.cause = error;
      const record = await captureIdleError(error);
      expect(record.err).toEqual({ name: 'DatabaseError', code });
    },
  );

  it('never reads message, stack, cause, driver payloads or serialization hooks', async () => {
    const readPrivateField = vi.fn(() => {
      throw new Error(privateData);
    });
    const error: Record<string, unknown> = {
      name: 'Error',
      code: 'ECONNRESET',
    };
    for (const field of [
      'message',
      'stack',
      'cause',
      'detail',
      'query',
      'toJSON',
    ]) {
      Object.defineProperty(error, field, { get: readPrivateField });
    }
    const record = await captureIdleError(error);
    expect(record.err).toEqual({ name: 'Error', code: 'ECONNRESET' });
    expect(readPrivateField).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    null,
    privateData,
    { name: privateData, code: privateData },
    Object.defineProperty({}, 'name', {
      get() {
        throw new Error(privateData);
      },
    }),
    new Proxy(
      {},
      {
        get() {
          throw new Error(privateData);
        },
      },
    ),
  ])(
    'handles an unknown or hostile error without escaping the listener: %#',
    async (error) => {
      const record = await captureIdleError(error);
      expect(record.err).toEqual({ name: 'UnknownError' });
    },
  );
});
