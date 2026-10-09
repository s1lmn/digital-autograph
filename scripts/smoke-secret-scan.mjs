import assert from 'node:assert/strict';
import console from 'node:console';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(resolve(tmpdir(), 'autograph-scanner-smoke-'));
const canary = ['gh', 'p_'].join('') + randomBytes(18).toString('hex');
const repository = resolve(temporary, 'repository');
mkdirSync(repository);
function git(...args) {
  const result = spawnSync('git', args, {
    cwd: repository,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Scanner fixture',
      GIT_AUTHOR_EMAIL: 'scanner@example.invalid',
      GIT_COMMITTER_NAME: 'Scanner fixture',
      GIT_COMMITTER_EMAIL: 'scanner@example.invalid',
    },
  });
  assert.equal(result.status, 0, 'Git fixture operation failed');
}
function commit() {
  git('add', '.');
  git(
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    'Synthetic scanner fixture',
  );
}
function scan(expected, target = repository, extraEnv = {}) {
  const result = spawnSync(
    process.execPath,
    [resolve(root, 'scripts/scan-secrets.mjs'), target],
    { encoding: 'utf8', env: { ...process.env, ...extraEnv } },
  );
  // Never include captured output or canary in an assertion failure message.
  assert.equal(result.status, expected, 'Unexpected scanner exit status');
  assert.ok(
    !`${result.stdout}${result.stderr}`.includes(canary),
    'Scanner exposed the synthetic credential',
  );
}
try {
  git('init', '-q');
  writeFileSync(resolve(repository, 'README.md'), 'Clean fixture\n');
  commit();
  scan(0);
  scan(2, temporary); // Not a Git repository must fail closed.
  scan(2, repository, { GITLEAKS_BIN: resolve(temporary, 'missing-scanner') });
  const fixtures = resolve(repository, 'tests/integration');
  mkdirSync(fixtures, { recursive: true });
  const reservation = resolve(fixtures, 'takeover-reservation.test.ts');
  writeFileSync(
    reservation,
    [
      ['strict', 'body', 'key', '01'],
      ['fresh', 'after', 'expiry', '01'],
      ['same', 'key', 'two', 'quotes', '01'],
    ]
      .map((parts) => parts.join('-'))
      .map((key) => `reserve(quote.id, buyer.token, '${key}');`)
      .join('\n'),
  );
  commit();
  scan(0); // Exact approved path + values are synthetic.
  writeFileSync(
    resolve(repository, 'other.ts'),
    `token = '${['same', 'key', 'two', 'quotes', '01'].join('-')}';`,
  );
  commit();
  scan(1); // The same value in a different path is not excluded.
  git('reset', '--hard', 'HEAD~1');
  writeFileSync(reservation, `token = '${canary}'; // gitleaks:allow\n`);
  commit();
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repository,
    encoding: 'utf8',
  });
  assert.equal(head.status, 0, 'Fixture head lookup failed');
  // A valid ignore fingerprint must not suppress the gate either.
  writeFileSync(
    resolve(repository, '.gitleaksignore'),
    `${head.stdout.trim()}:tests/integration/takeover-reservation.test.ts:github-pat:1\n`,
  );
  scan(2); // A valid fingerprint file blocks the gate instead of hiding findings.
  rmSync(resolve(repository, '.gitleaksignore'));
  scan(1); // Test files and inline allows cannot suppress real credential shapes.
  git('rm', '-q', 'tests/integration/takeover-reservation.test.ts');
  commit();
  scan(1); // Deleting a leaked file does not erase the historical finding.
  const shallow = resolve(temporary, 'shallow');
  const cloned = spawnSync('git', [
    'clone',
    '-q',
    '--depth=1',
    pathToFileURL(repository).href,
    shallow,
  ]);
  assert.equal(cloned.status, 0, 'Shallow fixture clone failed');
  scan(2, shallow);
  console.log(
    'Secret scanner smoke passed: detection, history, exceptions, safe output and failure guards.',
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
