export const unitTestInclude = [
  'apps/**/*.test.ts',
  'apps/**/*.test.tsx',
  'packages/**/*.test.ts',
];
export const unitTestExclude = ['**/node_modules/**', '**/dist/**'];
// Only tests requiring POSIX executable shims, Bash or Unix file modes use this suffix.
export const posixTestInclude = [
  'apps/**/*.posix.test.ts',
  'apps/**/*.posix.test.tsx',
  'packages/**/*.posix.test.ts',
];
