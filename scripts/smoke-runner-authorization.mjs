import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import console from 'node:console';
import { randomUUID } from 'node:crypto';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const context = mkdtempSync(path.join(os.tmpdir(), 'da-runner-auth-'));
const image = `da-runner-auth-${randomUUID()}:test`;
const workflow = readFileSync(
  path.join(root, '.github/workflows/release.yml'),
  'utf8',
);
const step = workflow
  .split('      - name: Deploy or roll back this VM\n')[1]
  ?.split('\n      - name:')[0]
  .split('        run: |\n')[1];
assert.ok(step, 'Release deployment step missing');
function docker(args) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: 600_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}
try {
  cpSync(path.join(root, 'deploy'), path.join(context, 'deploy'), {
    recursive: true,
  });
  cpSync(
    path.join(root, 'scripts/runner-authorization-smoke.Dockerfile'),
    path.join(context, 'Dockerfile'),
  );
  cpSync(
    path.join(root, 'scripts/runner-authorization-smoke.sh'),
    path.join(context, 'smoke.sh'),
  );
  writeFileSync(
    path.join(context, 'release-step.sh'),
    step
      .split('\n')
      .map((line) => line.replace(/^ {10}/, ''))
      .join('\n'),
  );
  docker(['build', '--tag', image, context]);
  // No TTY, mounts, privileged mode, host Docker socket or external network.
  console.log(docker(['run', '--rm', '--network', 'none', image]).trim());
} finally {
  spawnSync('docker', ['image', 'rm', image], { encoding: 'utf8' });
  rmSync(context, { recursive: true, force: true });
}
