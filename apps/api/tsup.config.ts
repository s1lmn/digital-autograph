import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts', 'src/payments/reconcile.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@digital-autograph\//],
  external: ['pg', 'google-auth-library', 'openid-client'],
});
