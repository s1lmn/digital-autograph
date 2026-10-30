import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
const script = fileURLToPath(
  new URL('../../../deploy/render-lockbox-env.mjs', import.meta.url),
);
it.each(['api', 'worker'])(
  'renders captured %s payload without cloud fetch, logging or bootstrap derivation',
  (app) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'destka-env-'));
    try {
      const out = path.join(dir, 'runtime.env');
      const input = readFileSync(
        new URL(
          `./fixtures/lockbox-${app}-payload-json-rest.json`,
          import.meta.url,
        ),
        'utf8',
      );
      const r = spawnSync(process.execPath, [script, out, 'staging'], {
        input,
        encoding: 'utf8',
      });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout + r.stderr).toBe('');
      expect(readFileSync(out, 'utf8')).toContain(
        "DATABASE_URL='postgresql://staging:synthetic%27password@postgres:5432/autograph_staging?sslmode=disable'",
      );
      expect(existsSync(path.join(dir, 'postgres.env'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
it('refuses the old API-DSN-to-bootstrap output before writing either file', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'destka-env-'));
  try {
    const out = path.join(dir, 'runtime.env'),
      pg = path.join(dir, 'postgres.env');
    const r = spawnSync(process.execPath, [script, out, 'staging', pg], {
      input: JSON.stringify({
        entries: [
          {
            key: 'DATABASE_URL',
            textValue: 'postgresql://user:synthetic-secret@postgres/db',
          },
        ],
      }),
      encoding: 'utf8',
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).not.toContain('synthetic-secret');
    expect(existsSync(out)).toBe(false);
    expect(existsSync(pg)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it.each([
  'postgresql://user:synthetic-secret@external.invalid/db',
  'postgresql://user:synthetic-secret@postgres:6432/db',
  'postgresql://user:synthetic-secret@postgres/db?host=external.invalid',
  'postgresql://user@postgres/db',
])('rejects unsafe local DSN without creating files', (url) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'destka-env-'));
  try {
    const out = path.join(dir, 'runtime.env');
    const r = spawnSync(process.execPath, [script, out, 'staging'], {
      input: JSON.stringify({
        entries: [{ key: 'DATABASE_URL', textValue: url }],
      }),
      encoding: 'utf8',
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).not.toContain('synthetic-secret');
    expect(existsSync(out)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it('rejects duplicate/newline entries and escapes quotes without logging values', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'destka-env-'));
  try {
    const out = path.join(dir, 'runtime.env');
    for (const entries of [
      [{ key: 'KEY', textValue: 'a\nb' }],
      [
        { key: 'KEY', textValue: 'a' },
        { key: 'KEY', textValue: 'b' },
      ],
    ])
      expect(
        spawnSync(process.execPath, [script, out], {
          input: JSON.stringify({ entries }),
          encoding: 'utf8',
        }).status,
      ).not.toBe(0);
    const r = spawnSync(process.execPath, [script, out], {
      input: JSON.stringify({
        entries: [{ key: 'KEY', textValue: "synthetic'value" }],
      }),
      encoding: 'utf8',
    });
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(out, 'utf8')).toBe("KEY='synthetic\\'value'\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
