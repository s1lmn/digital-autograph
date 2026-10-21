import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import domainBoundary from './scripts/eslint-domain-boundary.mjs';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/domain/src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
    plugins: { architecture: { rules: { 'domain-boundary': domainBoundary } } },
    rules: { 'architecture/domain-boundary': 'error' },
  },
);
