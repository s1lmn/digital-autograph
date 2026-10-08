import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const script = fileURLToPath(
  new URL('../../../deploy/render-lockbox-env.mjs', import.meta.url),
);
const stagingDatabase = JSON.stringify({
  entries: [
    {
      key: 'DATABASE_URL',
      textValue:
        'postgresql://staging:synthetic%27password@postgres:5432/autograph_staging?sslmode=disable',
    },
  ],
});

it.each(['api', 'worker', 'postgres', 'escaped'])(
  'writes %s runtime credentials with owner-only POSIX permissions',
  (kind) => {
    const directory = mkdtempSync(
      path.join(os.tmpdir(), 'da-lockbox-permissions-'),
    );
    try {
      const output = path.join(directory, 'runtime.env');
      const postgres = path.join(directory, 'postgres.env');
      const captured = kind === 'api' || kind === 'worker';
      const input = captured
        ? readFileSync(
            new URL(
              `./fixtures/lockbox-${kind}-payload-json-rest.json`,
              import.meta.url,
            ),
            'utf8',
          )
        : kind === 'postgres'
          ? stagingDatabase
          : JSON.stringify({
              entries: [
                { key: 'DATABASE_URL', textValue: 'postgres://user:p@ss/db' },
                { key: 'OAUTH_SECRET', textValue: "value's-safe" },
              ],
            });
      const args = [script, output];
      if (kind !== 'escaped') args.push('staging');
      if (kind === 'api' || kind === 'postgres') args.push(postgres);
      const result = spawnSync(process.execPath, args, {
        input,
        encoding: 'utf8',
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
      expect(statSync(output).mode & 0o777).toBe(0o600);
      if (kind === 'api' || kind === 'postgres')
        expect(statSync(postgres).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
