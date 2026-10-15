import { startApi } from './runtime';
import { runtimeFailureRecord } from '@digital-autograph/observability';
void startApi().catch((error: unknown) => {
  console.error(JSON.stringify(runtimeFailureRecord('api', error)));
  process.exitCode = 1;
});
