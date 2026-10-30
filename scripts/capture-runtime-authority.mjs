import console from 'node:console';
// Operator workstation only; strictly read-only control plane, never payload/token APIs.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
try {
  const [siteFile, output] = process.argv.slice(2);
  if (!siteFile || !output) throw Error();
  const site = JSON.parse(readFileSync(siteFile, 'utf8'));
  if (
    !/^[a-z0-9]{20}$/.test(site.instanceId) ||
    !Array.isArray(site.runtimeSecretIds) ||
    site.runtimeSecretIds.length !== 2 ||
    site.runtimeSecretIds.some((x) => !/^[a-z0-9]{20}$/.test(x)) ||
    !site.effectiveAuthorityReviewedBy
  )
    throw Error();
  const get = (args) => {
    const r = spawnSync('yc', [...args, '--format', 'json'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    if (r.status !== 0 || r.error) throw Error();
    return JSON.parse(r.stdout);
  };
  const vm = get(['compute', 'instance', 'get', site.instanceId]);
  if (vm.service_account_id !== site.runtimeServiceAccountId) throw Error();
  const lockbox = site.runtimeSecretIds.map((secretId) => {
    const response = get([
      'lockbox',
      'secret',
      'list-access-bindings',
      '--id',
      secretId,
    ]);
    const bindings = Array.isArray(response)
      ? response
      : response.access_bindings;
    if (!Array.isArray(bindings)) throw Error();
    return { secretId, bindings };
  });
  writeFileSync(
    output,
    JSON.stringify(
      {
        instanceId: site.instanceId,
        observedAt: new Date().toISOString(),
        runtimeServiceAccountId: vm.service_account_id,
        metadata_options: vm.metadata_options,
        lockbox,
        effectiveAuthorityReviewedBy: site.effectiveAuthorityReviewedBy,
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600, flag: 'wx' },
  );
  console.log(
    'Private read-only authority proof captured; no payloads read or settings changed.',
  );
} catch {
  console.error(
    'Authority proof capture refused; no control-plane mutation performed.',
  );
  process.exitCode = 1;
}
