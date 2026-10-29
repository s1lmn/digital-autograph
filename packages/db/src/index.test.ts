import { describe, expect, it, vi } from 'vitest';
import { createDatabase } from './index';

describe('PostgreSQL pool', () => {
  it('handles idle connection errors without terminating the process', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const database = createDatabase(
      'postgresql://user:password@127.0.0.1:5432/test',
    );

    try {
      expect(database.pool.emit('error', new Error('connection lost'))).toBe(
        true,
      );
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0]).toHaveLength(1);
      const serialized = log.mock.calls[0]![0] as string;
      expect(JSON.parse(serialized)).toMatchObject({
        event: 'POSTGRES_IDLE_CONNECTION_FAILED',
        err: { name: 'Error' },
        msg: 'PostgreSQL idle connection failed',
      });
      expect(serialized).not.toContain('connection lost');
    } finally {
      await database.close();
      log.mockRestore();
    }
  });
});
