import assert from 'node:assert/strict';
import console from 'node:console';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(resolve(tmpdir(), 'autograph-scanner-smoke-'));
// Deliberately synthetic and deterministic. Assemble provider prefixes so the
// smoke source is not itself a credential fixture. Never use these in an app.
const canary =
  ['gh', 'p_'].join('') +
  createHash('sha256')
    .update('scanner-smoke-provider-canary-v1')
    .digest('hex')
    .slice(0, 36);
// Digits avoid the pinned generic rule's alphabetic-only secret allowlist.
// Fixed high-entropy input also avoids randomly matching built-in stopwords.
const genericCanary = ['QmZrXnA9VtPsYkL2', 'HwBuCjE7NgRvTxS4'].join('');
const alphabeticGenericCanary = ['QmZrXnAaVtPsYkLd', 'HwBuCjEfNgRvTxSi'].join(
  '',
);
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
    ![canary, genericCanary, alphabeticGenericCanary].some((value) =>
      `${result.stdout}${result.stderr}`.includes(value),
    ),
    'Scanner exposed the synthetic credential',
  );
}
try {
  git('init', '-q', '-b', 'main');
  writeFileSync(resolve(repository, 'README.md'), 'Clean fixture\n');
  commit();
  const cleanHead = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repository,
    encoding: 'utf8',
  });
  assert.equal(cleanHead.status, 0, 'Clean fixture head lookup failed');
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
  const checkout = resolve(repository, 'apps/web/components/paid-checkout.tsx');
  mkdirSync(dirname(checkout), { recursive: true });
  const publicComment =
    '// Check the published API bytes too: unavailable/tampered/placeholder documents never enable submission.\n';
  writeFileSync(checkout, publicComment);
  commit();
  scan(0); // Exact known public comment AND exact checkout path.
  writeFileSync(resolve(repository, 'other-comment.ts'), publicComment);
  commit();
  scan(1); // The same scanner match elsewhere is not excluded.
  git('reset', '--hard', 'HEAD~1');
  writeFileSync(checkout, `token = '${canary}';\n`);
  commit();
  scan(1); // A credential in the checkout path still blocks the gate.
  git('reset', '--hard', 'HEAD~1');
  for (const path of [
    'apps/web/components/paid-checkout.tsx',
    'scripts/smoke-secret-scan.mjs',
    'docs/operations/secret-scanning.md',
  ]) {
    const file = resolve(repository, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `api_key = '${genericCanary}';\n`);
    commit();
    scan(1); // Other generic-api-key values in every exact path still fail.
    git('reset', '--hard', 'HEAD~1');
  }
  // Regression for the old randomized generic canary: high-entropy letters
  // are explicitly allowed by the pinned built-in rule, so not every random
  // base64url value is a positive fixture. No scanner exceptions are changed.
  const genericHistory = resolve(repository, 'generic-history.ts');
  writeFileSync(genericHistory, `api_key = '${alphabeticGenericCanary}';\n`);
  commit();
  scan(0);
  writeFileSync(genericHistory, `api_key = '${genericCanary}';\n`);
  commit();
  scan(1);
  git('rm', '-q', 'generic-history.ts');
  commit();
  scan(1); // Generic findings survive deletion, independently of provider rules.
  git('reset', '--hard', 'HEAD~3');
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

  // Start again with clean reachable history so ordinary commits cannot mask
  // failure to scan a credential introduced only by a two-parent merge.
  git('reset', '--hard', cleanHead.stdout.trim());
  git('switch', '-qc', 'side');
  writeFileSync(resolve(repository, 'side.txt'), 'Clean side\n');
  commit();
  git('switch', '-q', 'main');
  writeFileSync(resolve(repository, 'main.txt'), 'Clean main\n');
  commit();
  git('merge', '--no-ff', '--no-commit', 'side');
  commit();
  scan(0); // A clean two-parent merge must still pass.

  git('reset', '--hard', 'HEAD~1');
  git('merge', '--no-ff', '--no-commit', 'side');
  writeFileSync(resolve(repository, 'merge-only.ts'), `token = '${canary}';\n`);
  commit();
  scan(1); // Neither parent contains this merge-created credential.
  git('rm', '-q', 'merge-only.ts');
  commit();
  scan(1); // Later deletion must not hide the merge-only historical finding.
  // Repeat the merge-only/deleted-history checks with ONLY the generic rule.
  // A provider-pattern finding must not mask a broken generic canary.
  git('reset', '--hard', cleanHead.stdout.trim());
  writeFileSync(resolve(repository, 'main.txt'), 'Clean main\n');
  commit();
  git('merge', '--no-ff', '--no-commit', 'side');
  writeFileSync(
    resolve(repository, 'merge-only.ts'),
    `api_key = '${genericCanary}';\n`,
  );
  commit();
  scan(1);
  git('rm', '-q', 'merge-only.ts');
  commit();
  scan(1);
  console.log(
    'Secret scanner smoke passed: detection, merge history, exceptions, safe output and failure guards.',
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
