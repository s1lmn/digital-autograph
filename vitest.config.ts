import { defineConfig } from 'vitest/config';
import {
  posixTestInclude,
  unitTestExclude,
  unitTestInclude,
} from './vitest.unit';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: unitTestInclude,
    exclude: [
      ...unitTestExclude,
      ...(process.platform === 'win32' ? posixTestInclude : []),
    ],
  },
});
