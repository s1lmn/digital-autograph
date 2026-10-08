import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
const script = new URL(
  '../../../deploy/staging-storage-cors.mjs',
  import.meta.url,
);
const config = new URL(
  '../../../deploy/storage-cors.staging.xml',
  import.meta.url,
);
function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'da-cors-validation-'));
  copyFileSync(script, path.join(directory, 'staging-storage-cors.mjs'));
  copyFileSync(config, path.join(directory, 'storage-cors.staging.xml'));
  return {
    directory,
    run: (mode: string) =>
      spawnSync(
        process.execPath,
        [path.join(directory, 'staging-storage-cors.mjs'), mode],
        {
          encoding: 'utf8',
          // A successful validate or a specific configuration error cannot invoke this absent CLI.
          env: { ...process.env, YC_BIN: path.join(directory, 'absent-yc') },
        },
      ),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}
describe('staging CORS validation without platform executable shims', () => {
  it('validates the actual XML with exact origin, PUT/GET and signed headers without cloud credentials', () => {
    const f = fixture();
    try {
      const result = f.run('validate');
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      const xml = readFileSync(config, 'utf8');
      expect(xml).not.toMatch(/\*|DELETE|POST|OPTIONS|Public|ACL/);
      const storage = readFileSync(
        new URL(
          '../../../packages/integrations/src/private-s3.ts',
          import.meta.url,
        ),
        'utf8',
      );
      expect(storage).toContain(
        "signableHeaders: new Set(['content-type', 'if-none-match'])",
      );
      expect(storage).toContain("IfNoneMatch: '*'");
    } finally {
      f.cleanup();
    }
  });

  it.each([
    ['https://staging.destka.online', '*'],
    ['https://staging.destka.online', 'https://production.example'],
    ['<AllowedMethod>GET</AllowedMethod>', ''],
    [
      '<AllowedMethod>GET</AllowedMethod>',
      '<AllowedMethod>DELETE</AllowedMethod>',
    ],
    ['<AllowedHeader>If-None-Match</AllowedHeader>', ''],
    ['</CORSRule>', '<PublicRead>true</PublicRead></CORSRule>'],
  ])('rejects unsafe/incomplete configuration (%s)', (from, to) => {
    const f = fixture();
    try {
      writeFileSync(
        path.join(f.directory, 'storage-cors.staging.xml'),
        readFileSync(config, 'utf8').replace(from, to),
      );
      const result = f.run('apply');
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'Repository staging CORS configuration is invalid',
      );
    } finally {
      f.cleanup();
    }
  });

  it('keeps bucket configuration outside release and application startup paths', () => {
    for (const file of [
      '../../../.github/workflows/release.yml',
      '../../../deploy/deploy-on-vm.sh',
      '../src/main.ts',
      '../../worker/src/main.ts',
    ]) {
      expect(readFileSync(new URL(file, import.meta.url), 'utf8')).not.toMatch(
        /staging-storage-cors|PutBucketCors|storage bucket update/,
      );
    }
  });
});
