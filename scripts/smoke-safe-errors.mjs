import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const directory = mkdtempSync(path.join(tmpdir(), 'autograph-safe-errors-'));
const target = path.resolve(directory);
if (
  path.dirname(target) !== path.resolve(tmpdir()) ||
  !path.basename(target).startsWith('autograph-safe-errors-')
) {
  throw new Error('Unsafe temporary smoke directory');
}
const canary = 'synthetic-private-signed-url-and-password-canary';
try {
  const preload = path.join(directory, 'failure.cjs');
  // Trigger a caught configuration failure before any DB/storage/provider call.
  writeFileSync(
    preload,
    `
    const original = process.env;
    process.env = new Proxy(original, {
      get(target, key) {
        if (key === 'APP_ENV') {
          throw Object.assign(new Error(${JSON.stringify(canary)}, {
            cause: new Error(${JSON.stringify(canary)})
          }), { code: 'ECONNREFUSED', credential: ${JSON.stringify(canary)} });
        }
        return Reflect.get(target, key);
      }
    });
  `,
  );
  for (const runtime of ['api', 'worker']) {
    const result = spawnSync(
      process.execPath,
      ['--require', preload, `apps/${runtime}/dist/main.js`],
      {
        encoding: 'utf8',
        timeout: 15000,
        windowsHide: true,
      },
    );
    if (result.error || result.status !== 1) {
      throw new Error(`Built ${runtime} did not fail safely with exit code 1`);
    }
    const output = result.stdout + result.stderr;
    if (output.includes(canary))
      throw new Error(`Built ${runtime} leaked synthetic sensitive data`);
    const records = result.stderr.split('\n').flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
    const failure = records.find((record) => record.event === 'STARTUP_FAILED');
    if (
      !failure ||
      failure.runtime !== runtime ||
      failure.level !== 50 ||
      failure.err?.name !== 'Error' ||
      failure.err?.code !== 'ECONNREFUSED' ||
      Number.isNaN(Date.parse(failure.time)) ||
      Object.keys(failure.err).some(
        (key) => !['name', 'code', 'statusCode'].includes(key),
      )
    ) {
      throw new Error(
        `Built ${runtime} failure record does not match the safe diagnostic contract`,
      );
    }
  }
  process.stdout.write('Built API/worker safe startup error smoke passed\n');
} finally {
  rmSync(target, { recursive: true, force: true });
}
