// Test-only composition: never imported by the runtime entrypoint or container build.
import { syntheticPayment } from './synthetic-payment';
import { startApi } from '../apps/api/src/runtime';
import { syntheticFirstUseDocuments } from '../tests/integration/first-use-fixtures';
import { isolatedE2EEnvironment } from './environment';
isolatedE2EEnvironment();
const terms = syntheticFirstUseDocuments.find(
  (d) => d.type === 'terms_of_use',
)!;
void startApi(
  [
    ...syntheticFirstUseDocuments,
    {
      ...syntheticFirstUseDocuments.find((d) => d.type === 'public_offer')!,
      current: false,
      version: 'test-v0',
      path: '/legal/documents/public_offer/test-v0',
    },
    {
      ...terms,
      current: false,
      version: 'test-v0',
      path: '/legal/documents/terms_of_use/test-v0',
    },
  ],
  syntheticPayment,
).catch(() => {
  console.error('Synthetic E2E API startup failed');
  process.exitCode = 1;
});
