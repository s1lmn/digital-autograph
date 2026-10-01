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
  it('derives owner-only staging PostgreSQL credentials from the API DATABASE_URL without logging them', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'da-lockbox-'));
    try {
      const output = path.join(directory, 'api.env');
      const postgres = path.join(directory, 'postgres.env');
      const result = spawnSync(
        process.execPath,
        [script, output, 'staging', postgres],
        {
          input: JSON.stringify({
            entries: [
              {
                key: 'DATABASE_URL',
                textValue:
                  'postgresql://staging:synthetic%27password@postgres:5432/autograph_staging?sslmode=disable',
              },
            ],
          }),
          encoding: 'utf8',
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe('');
      expect(readFileSync(postgres, 'utf8')).toBe(
        "POSTGRES_USER='staging'\nPOSTGRES_PASSWORD='synthetic\\'password'\nPOSTGRES_DB='autograph_staging'\n",
      );
      expect(statSync(postgres).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it.each([
    'postgresql://user:synthetic-password@external.example/db',
    'postgresql://user:synthetic-password@postgres:6432/db',
    'postgresql://user:synthetic-password@postgres/db?sslmode=verify-full',
    'postgresql://user:synthetic-password@postgres/db?host=external.example',
    'postgresql://user@postgres/db',
  ])(
    'rejects unsafe staging DATABASE_URL %s before writing runtime files',
    (url) => {
      const directory = mkdtempSync(path.join(os.tmpdir(), 'da-lockbox-'));
      const output = path.join(directory, 'worker.env');
      try {
        const result = spawnSync(
          process.execPath,
          [script, output, 'staging'],
          {
            input: JSON.stringify({
              entries: [{ key: 'DATABASE_URL', textValue: url }],
            }),
            encoding: 'utf8',
          },
        );
        expect(result.status).not.toBe(0);
        expect(result.stderr).not.toContain('synthetic-password');
        expect(() => readFileSync(output)).toThrow();
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
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
