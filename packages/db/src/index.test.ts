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
      expect(log).toHaveBeenCalledWith(
        'PostgreSQL idle connection error:',
        'connection lost',
      );
    } finally {
      await database.close();
      log.mockRestore();
    }
  });
});
