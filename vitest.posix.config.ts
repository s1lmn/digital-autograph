import { defineConfig } from 'vitest/config';
import { posixTestInclude, unitTestExclude } from './vitest.unit';

if (process.platform === 'win32') {
  throw new Error(
    'POSIX deployment tests require Linux; run pnpm test:portable on Windows.',
  );
}

export default defineConfig({
  test: {
    include: posixTestInclude,
    exclude: unitTestExclude,
  },
});
