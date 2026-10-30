import { loadApiStartupConfig } from './startup-config';
import { startApi } from './runtime';
import { runtimeFailureRecord } from '@digital-autograph/observability';
void (async () => {
  if (process.argv.length === 3 && process.argv[2] === '--check-config') {
    loadApiStartupConfig();
    console.log('API_STARTUP_CONFIG_VALID');
  } else await startApi();
})().catch((error: unknown) => {
  console.error(JSON.stringify(runtimeFailureRecord('api', error)));
  process.exitCode = 1;
});
