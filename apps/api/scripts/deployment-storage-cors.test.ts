import { spawnSync } from 'node:child_process';
import {
  chmodSync,
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
const expectedCors = [
  {
    allowedOrigins: ['https://staging.destka.online'],
    allowedMethods: ['METHOD_PUT', 'METHOD_GET'],
    allowedHeaders: ['Content-Type', 'If-None-Match'],
    maxAgeSeconds: '300',
  },
];
const privateBucket = {
  name: 'digital-autograph-staging-e6ic8eh2',
  anonymousAccessFlags: { read: false, list: false, configRead: false },
  acl: {
    grants: [
      {
        grantType: 'GRANT_TYPE_ACCOUNT',
        permission: 'PERMISSION_WRITE',
        granteeId: 'synthetic-runtime',
      },
    ],
  },
  policy: {
    Statement: [
      {
        Effect: 'Allow',
        Principal: { CanonicalUser: 'synthetic-runtime' },
        Action: 's3:PutObject',
      },
    ],
  },
};

function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'da-cors-'));
  const state = path.join(directory, 'bucket.json');
  const calls = path.join(directory, 'calls.json');
  const fake = path.join(directory, 'yc');
  copyFileSync(script, path.join(directory, 'staging-storage-cors.mjs'));
  copyFileSync(config, path.join(directory, 'storage-cors.staging.xml'));
  writeFileSync(state, JSON.stringify(privateBucket));
  writeFileSync(calls, '[]');
  writeFileSync(
    fake,
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const calls = JSON.parse(fs.readFileSync(process.env.CORS_TEST_CALLS, 'utf8'));
calls.push(args);
fs.writeFileSync(process.env.CORS_TEST_CALLS, JSON.stringify(calls));
if (process.env.CORS_TEST_FAIL) { process.stderr.write('synthetic-secret-and-signed-url'); process.exit(1); }
const state = JSON.parse(fs.readFileSync(process.env.CORS_TEST_STATE, 'utf8'));
if (args[2] === 'update') {
  state.cors = ${JSON.stringify(expectedCors)};
  if (process.env.CORS_TEST_MUTATE) state.anonymousAccessFlags.read = true;
  if (process.env.CORS_TEST_POLICY_MUTATE) state.policy = {};
  fs.writeFileSync(process.env.CORS_TEST_STATE, JSON.stringify(state));
}
process.stdout.write(JSON.stringify(state));
`,
  );
  chmodSync(fake, 0o700);
  return {
    directory,
    state,
    calls: () => JSON.parse(readFileSync(calls, 'utf8')) as string[][],
    run: (mode: string, extra = {}) =>
      spawnSync(
        process.execPath,
        [path.join(directory, 'staging-storage-cors.mjs'), mode],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            YC_BIN: fake,
            CORS_TEST_STATE: state,
            CORS_TEST_CALLS: calls,
            ...extra,
          },
        },
      ),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

describe('operator staging Object Storage CORS', () => {
  it('validates the actual XML with exact origin, PUT/GET and signed headers without cloud credentials', () => {
    const f = fixture();
    try {
      expect(f.run('validate').status).toBe(0);
      expect(f.calls()).toEqual([]);
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
      expect(f.run('apply').status).toBe(1);
      expect(f.calls()).toEqual([]);
    } finally {
      f.cleanup();
    }
  });

  it('check mode reads the current CORS without changing a missing rule', () => {
    const f = fixture();
    try {
      const before = readFileSync(f.state, 'utf8');
      const result = f.run('check');
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        cors: [],
        matches: false,
      });
      expect(f.calls()).toEqual([
        [
          'storage',
          'bucket',
          'get',
          '--name',
          privateBucket.name,
          '--full',
          '--format',
          'json-rest',
        ],
      ]);
      expect(readFileSync(f.state, 'utf8')).toBe(before);
    } finally {
      f.cleanup();
    }
  });

  it('requires explicit apply, changes CORS only, and is idempotent', () => {
    const f = fixture();
    try {
      expect(f.run('unknown').status).toBe(1);
      expect(f.calls()).toEqual([]);
      expect(f.run('apply').status).toBe(0);
      expect(f.calls().filter((args) => args[2] === 'update')).toEqual([
        [
          'storage',
          'bucket',
          'update',
          '--name',
          privateBucket.name,
          '--cors',
          'allowed-origins=[https://staging.destka.online],allowed-methods=[method-put,method-get],allowed-headers=[Content-Type,If-None-Match],max-age-seconds=300',
          '--format',
          'json-rest',
        ],
      ]);
      expect(JSON.parse(readFileSync(f.state, 'utf8'))).toEqual({
        ...privateBucket,
        cors: expectedCors,
      });
      expect(f.run('apply').status).toBe(0);
      expect(f.run('check').status).toBe(0);
      expect(f.calls().filter((args) => args[2] === 'update')).toHaveLength(1);
    } finally {
      f.cleanup();
    }
  });

  it.each(['read', 'list', 'configRead'])(
    'refuses public %s before making any change',
    (flag) => {
      const f = fixture();
      try {
        writeFileSync(
          f.state,
          JSON.stringify({
            ...privateBucket,
            anonymousAccessFlags: {
              ...privateBucket.anonymousAccessFlags,
              [flag]: true,
            },
          }),
        );
        expect(f.run('apply').status).toBe(1);
        expect(f.calls().some((args) => args[2] === 'update')).toBe(false);
      } finally {
        f.cleanup();
      }
    },
  );

  it.each(['acl', 'policy'])(
    'refuses public %s without rewriting access controls',
    (setting) => {
      const f = fixture();
      try {
        writeFileSync(
          f.state,
          JSON.stringify({
            ...privateBucket,
            [setting]:
              setting === 'acl'
                ? {
                    grants: [
                      {
                        grantType: 'GRANT_TYPE_ALL_USERS',
                        permission: 'PERMISSION_READ',
                      },
                    ],
                  }
                : {
                    Statement: [
                      {
                        Effect: 'Allow',
                        Principal: '*',
                        Action: 's3:GetObject',
                      },
                    ],
                  },
          }),
        );
        expect(f.run('apply').status).toBe(1);
        expect(f.calls().some((args) => args[2] === 'update')).toBe(false);
      } finally {
        f.cleanup();
      }
    },
  );

  it.each(['CORS_TEST_MUTATE', 'CORS_TEST_POLICY_MUTATE'])(
    'detects unexpected changes to non-CORS settings (%s)',
    (setting) => {
      const f = fixture();
      try {
        expect(f.run('apply', { [setting]: '1' }).status).toBe(1);
      } finally {
        f.cleanup();
      }
    },
  );

  it('suppresses sensitive CLI error output', () => {
    const f = fixture();
    try {
      const result = f.run('check', { CORS_TEST_FAIL: '1' });
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).not.toContain(
        'synthetic-secret-and-signed-url',
      );
      expect(result.stderr).toContain('CLI output suppressed');
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
