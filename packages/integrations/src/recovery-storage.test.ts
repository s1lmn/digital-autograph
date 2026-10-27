import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  validateRecoveryEndpoint,
  verifyRecoveryBytes,
} from './recovery-storage';

describe('recovery drill isolation and integrity', () => {
  it.each([
    'https://storage.yandexcloud.net',
    'http://localhost:9000',
    'http://127.0.0.1.evil.test:9000',
    'http://127.0.0.1:9000/path',
    'http://u:p@127.0.0.1:9000',
    'http://127.0.0.1:9000/?token=secret',
    'http://127.0.0.1:9000/#x',
    'http://127.0.0.1',
  ])('rejects external, ambiguous or credentialed storage: %s', (endpoint) => {
    expect(() => validateRecoveryEndpoint(endpoint, 'test')).toThrow();
  });
  it('requires a test environment and explicit loopback port', () => {
    expect(validateRecoveryEndpoint('http://127.0.0.1:9000', 'test')).toBe(
      'http://127.0.0.1:9000',
    );
    for (const environment of ['local', 'staging', 'production', ''])
      expect(() =>
        validateRecoveryEndpoint('http://127.0.0.1:9000', environment),
      ).toThrow();
  });
  it('rejects tampering, truncation and oversized archives before restoration', () => {
    const bytes = Buffer.alloc(96, 7);
    const digest = createHash('sha256').update(bytes).digest('hex');
    expect(() => verifyRecoveryBytes(bytes, digest)).not.toThrow();
    for (const invalid of [
      Buffer.alloc(96, 8),
      bytes.subarray(1),
      Buffer.alloc(97),
    ])
      expect(() => verifyRecoveryBytes(invalid, digest)).toThrow();
    expect(() => verifyRecoveryBytes(bytes, 'private-key')).toThrow();
  });
});
