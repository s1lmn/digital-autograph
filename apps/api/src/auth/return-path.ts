export function normalizeReturnPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) return '/';
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    Array.from(value).some(
      (character) =>
        character === '\\' ||
        character.charCodeAt(0) < 32 ||
        character.charCodeAt(0) === 127,
    ) ||
    /%(?:2f|5c|0[0-9a-f]|7f|25)/i.test(value)
  ) {
    return '/';
  }
  try {
    const url = new URL(value, 'https://app.invalid');
    if (url.origin !== 'https://app.invalid') return '/';
    return `${url.pathname}${url.search}`;
  } catch {
    return '/';
  }
}
