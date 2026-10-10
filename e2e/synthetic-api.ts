// Test-only composition: never imported by the runtime entrypoint or container build.
import { startApi } from '../apps/api/src/runtime';
import { syntheticFirstUseDocuments } from '../tests/integration/first-use-fixtures';
import { isolatedE2EEnvironment } from './environment';
isolatedE2EEnvironment();
const terms = syntheticFirstUseDocuments.find(
  (d) => d.type === 'terms_of_use',
)!;
void startApi([
  ...syntheticFirstUseDocuments,
  {
    ...terms,
    current: false,
    version: 'test-v0',
    path: '/legal/documents/terms_of_use/test-v0',
  },
]).catch(() => {
  console.error('Synthetic E2E API startup failed');
  process.exitCode = 1;
});
