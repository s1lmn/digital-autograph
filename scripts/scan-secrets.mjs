import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import console from 'node:console';
import process from 'node:process';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = resolve(process.argv[2] ?? root);
const binary = process.env.GITLEAKS_BIN ?? 'gitleaks';
const version = spawnSync(binary, ['version'], { encoding: 'utf8' });
const shallow = spawnSync('git', ['rev-parse', '--is-shallow-repository'], {
  cwd: repository,
  encoding: 'utf8',
});
if (version.status !== 0 || version.stdout.trim() !== '8.24.3') {
  console.error('Secret scan requires the reviewed Gitleaks 8.24.3 binary.');
  process.exit(2);
}
if (shallow.status !== 0 || shallow.stdout.trim() !== 'false') {
  console.error('Secret scan requires a non-shallow Git repository.');
  process.exit(2);
}
// Gitleaks 8.24.3 always loads source/.gitleaksignore in addition to --ignore-path.
// Refuse it rather than silently accepting an unreviewed suppression mechanism.
if (existsSync(resolve(repository, '.gitleaksignore'))) {
  console.error(
    'Repository .gitleaksignore is forbidden; use reviewed config exceptions.',
  );
  process.exit(2);
}

// Do not honor repository .gitleaksignore or inline allow comments. Exceptions
// belong in the reviewed config. Never persist findings or echo scanner output.
const ignoreDirectory = mkdtempSync(
  resolve(tmpdir(), 'autograph-secret-scan-'),
);
try {
  const result = spawnSync(
    binary,
    [
      'git',
      '--config',
      resolve(root, '.gitleaks.toml'),
      '--gitleaks-ignore-path',
      ignoreDirectory,
      '--ignore-gitleaks-allow',
      '--log-opts=--all',
      '--redact=100',
      '--no-banner',
      '--no-color',
      '--log-level=error',
      repository,
    ],
    { stdio: 'ignore' },
  );
  if (result.status === 0) {
    console.log('Secret scan passed: full available Git history.');
  } else {
    console.error(
      'Secret scan failed. Follow docs/operations/secret-scanning.md for private triage and rotation.',
    );
  }
  process.exitCode = result.status === 0 ? 0 : 1;
} finally {
  rmSync(ignoreDirectory, { recursive: true, force: true });
}
