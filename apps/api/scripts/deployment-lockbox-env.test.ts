import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(
  new URL('../../../deploy/render-lockbox-env.mjs', import.meta.url),
);

describe('Lockbox environment renderer', () => {
  it('writes escaped entries with owner-only permissions', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'da-lockbox-'));
    const outputPath = path.join(directory, 'runtime.env');
    try {
      const result = spawnSync(process.execPath, [script, outputPath], {
        input: JSON.stringify({
          entries: [
            { key: 'DATABASE_URL', textValue: 'postgres://user:p@ss/db' },
            { key: 'OAUTH_SECRET', textValue: "value's-safe" },
          ],
        }),
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(readFileSync(outputPath, 'utf8')).toBe(
        "DATABASE_URL='postgres://user:p@ss/db'\nOAUTH_SECRET='value\\'s-safe'\n",
      );
      if (process.platform !== 'win32') {
        expect(statSync(outputPath).mode & 0o777).toBe(0o600);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects unsafe or ambiguous entries without creating the output file', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'da-lockbox-'));
    const outputPath = path.join(directory, 'runtime.env');
    try {
      const result = spawnSync(process.execPath, [script, outputPath], {
        input: JSON.stringify({
          entries: [{ key: 'DATABASE_URL', textValue: 'line 1\nline 2' }],
        }),
        encoding: 'utf8',
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('invalid environment entry');
      expect(() => readFileSync(outputPath)).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
