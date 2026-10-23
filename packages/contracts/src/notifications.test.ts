import { expect, it } from 'vitest';
import { notificationPreferencesBody } from './notifications';

it('rejects oversized preferences before accumulating an issue for every invalid collection item', () => {
  // A small synthetic input exercises the advisory without an OOM-sized attack.
  const result = notificationPreferencesBody.safeParse({
    web: false,
    telegram: false,
    mutedKinds: Array(1000).fill(null),
  });
  expect(result.success).toBe(false);
  if (result.success) throw new Error('Oversized preferences were accepted');
  expect(result.error.issues).toHaveLength(1);
  expect(result.error.issues[0]).toMatchObject({
    code: 'too_big',
    path: ['mutedKinds'],
    maximum: 7,
  });
});
