import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/recovery/**/*.test.ts'], fileParallelism: false },
});
