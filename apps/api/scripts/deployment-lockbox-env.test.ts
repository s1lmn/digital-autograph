import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(
  new URL('../../../deploy/render-lockbox-env.mjs', import.meta.url),
);

describe('Lockbox environment renderer', () => {
  it.each(['api', 'worker'])(
    'reads the captured yc json-rest %s contract without logging secret values',
    (app) => {
      // Captured from yc 1.39.0; every value and version ID is synthetic.
      const input = readFileSync(
        new URL(
          `./fixtures/lockbox-${app}-payload-json-rest.json`,
          import.meta.url,
        ),
        'utf8',
      );
      const directory = mkdtempSync(path.join(os.tmpdir(), 'da-lockbox-'));
      try {
        const output = path.join(directory, `${app}.env`);
        const postgres = path.join(directory, 'postgres.env');
        const args = [script, output, 'staging'];
        if (app === 'api') args.push(postgres);
        const result = spawnSync(process.execPath, args, {
          input,
          encoding: 'utf8',
        });
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe('');
        const environment = readFileSync(output, 'utf8');
        expect(environment).toContain(
          "DATABASE_URL='postgresql://staging:synthetic%27password@postgres:5432/autograph_staging?sslmode=disable'\n",
        );
        expect(environment).toContain(
          "S3_ENDPOINT='https://storage.example.invalid'\n",
        );
        expect(environment).toContain(
          "S3_SECRET_ACCESS_KEY='synthetic-s3_secret_access_key'\n",
        );
        expect(environment).toContain(
          app === 'api'
            ? "SESSION_TTL_SECONDS='1209600'\n"
            : "WORKER_LEASE_SECONDS='300'\n",
        );
        if (app === 'api') {
          expect(readFileSync(postgres, 'utf8')).toBe(
            "POSTGRES_USER='staging'\nPOSTGRES_PASSWORD='synthetic\\'password'\nPOSTGRES_DB='autograph_staging'\n",
          );
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it('uses only the compatible json-rest payload format in the release path', () => {
    const deploy = readFileSync(
      new URL('../../../deploy/deploy-on-vm.sh', import.meta.url),
      'utf8',
    );
    const commands = deploy.match(/yc lockbox payload get[^|]+/g);
    expect(commands).toHaveLength(1);
    expect(commands![0]).toMatch(/--format json-rest\s*$/);
    expect(commands![0]).not.toMatch(/--format json(?:\s|$)/);
    expect(deploy).toMatch(
      /yc lockbox payload get --id "\$secret_id" --format json-rest \|\s*node "\$root\/render-lockbox-env\.mjs"/,
    );
  });

  it('derives staging PostgreSQL credentials from the API DATABASE_URL without logging them', () => {
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
  it('writes escaped entries', () => {
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
