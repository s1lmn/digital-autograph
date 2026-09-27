import { describe, expect, it } from 'vitest';
import { normalizeReturnPath } from './return-path';

describe('Google return path', () => {
  it('keeps local paths and queries', () => {
    expect(normalizeReturnPath('/')).toBe('/');
    expect(normalizeReturnPath('/wall/123?tab=history')).toBe(
      '/wall/123?tab=history',
    );
  });

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/%2f%2fevil.example',
    '/%5cevil.example',
    'javascript:alert(1)',
    '/wall\r\nLocation: https://evil.example',
    ' /wall',
    '',
    null,
  ])('falls back to root for unsafe input %s', (value) => {
    expect(normalizeReturnPath(value)).toBe('/');
  });
});
