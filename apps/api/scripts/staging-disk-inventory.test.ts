import { spawnSync } from 'node:child_process';
import {
  Dir,
  type Dirent,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const script = new URL(
  '../../../deploy/staging-disk-inventory.mjs',
  import.meta.url,
);
const { collectInventory } = await import(script.href);
const current = 'a'.repeat(40);
const previous = 'b'.repeat(40);
const image = `sha256:${'c'.repeat(64)}`;
const id = 'd'.repeat(64);
const secret = 'DO-NOT-PRINT-secret-canary';

function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'da-inventory-'));
  mkdirSync(path.join(directory, 'staging-backups'));
  writeFileSync(path.join(directory, 'current-image-tag'), `${current}\n`);
  writeFileSync(path.join(directory, 'previous-image-tag'), previous);
  writeFileSync(
    path.join(directory, 'staging-backups', '20261007T120000-123.dump'),
    'synthetic backup',
  );
  writeFileSync(
    path.join(directory, 'staging-backups', '20261007T130000-124.dump.tmp'),
    'incomplete',
  );
  writeFileSync(path.join(directory, 'api.env'), secret);
  writeFileSync(
    path.join(directory, 'staging-backups', 'private-object'),
    secret,
  );
  const calls: { binary: string; args: string[] }[] = [];
  function run(binary: string, args: string[]) {
    calls.push({ binary, args });
    let stdout = '';
    if (binary === 'df') stdout = 'header\n10000 9000 1000 90% 100 95 5 95%\n';
    else if (binary === 'du')
      stdout = args.includes('--max-depth=1')
        ? '300\t/var\n200\t/home\n500\t/\n'
        : `123\t${args.at(-1)}\n`;
    else if (args[0] === 'info') stdout = '/var/lib/docker';
    else if (args[0] === 'system')
      stdout = JSON.stringify({
        Type: 'Images',
        TotalCount: 2,
        Active: 1,
        Size: '2.3GB',
        Reclaimable: '1.2GB (50%)',
        secret,
      });
    else if (args[0] === 'image')
      stdout = [current, previous]
        .map((Tag) =>
          JSON.stringify({
            ID: image,
            Repository: 'cr.yandex/registry/digital-autograph/api',
            Tag,
            Size: '200MB',
            secret,
          }),
        )
        .join('\n');
    else if (args[0] === 'ps') stdout = id;
    else if (args[0] === 'container')
      stdout = JSON.stringify({
        id,
        imageId: image,
        status: 'running',
        service: 'api',
        Env: [secret],
        Args: [secret],
        volumes: [
          {
            type: 'volume',
            name: 'digital-autograph-staging-postgres',
            Source: secret,
          },
          { type: 'bind', name: '', Source: secret },
        ],
      });
    else if (args[0] === 'volume')
      stdout = JSON.stringify({
        Name: 'digital-autograph-staging-postgres',
        Labels: { secret },
      });
    else throw new Error('unexpected command');
    return { stdout, stderr: secret, status: 0, signal: null };
  }
  return {
    directory,
    calls,
    run,
    collect: (customRun = run) =>
      collectInventory({
        runnerRoot: '/runner path & literal',
        stateRoot: directory,
        run: customRun,
      }),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

describe('read-only staging disk inventory', () => {
  it.skipIf(process.platform === 'linux')(
    'rejects an unsupported host before any executable or filesystem probe',
    () => {
      const result = spawnSync(process.execPath, [fileURLToPath(script)], {
        encoding: 'utf8',
        env: { ...process.env, PATH: '/nonexistent-da-inventory-path' },
      });
      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe(
        'Inventory requires Linux; no probes were executed.\n',
      );
    },
  );

  it.each(['ascending', 'descending'])(
    'preserves inode/byte, rollback image and mounted volume evidence without secret fields or backup contents with %s directory enumeration',
    (order) => {
      const f = fixture();
      const readSync = Dir.prototype.readSync;
      let entries: Dirent[] | undefined;
      const enumeratedNames: string[] = [];
      const read = vi
        .spyOn(Dir.prototype, 'readSync')
        .mockImplementation(function (this: Dir) {
          if (!entries) {
            // Read real entries, then force both orders regardless of filesystem behavior.
            entries = [];
            let entry;
            while ((entry = readSync.call(this))) entries.push(entry);
            entries.sort((a, b) => a.name.localeCompare(b.name));
            if (order === 'descending') entries.reverse();
          }
          const entry = entries.shift() ?? null;
          if (entry) enumeratedNames.push(entry.name);
          return entry;
        });
      try {
        const report = f.collect();
        const expectedNames = [
          '20261007T120000-123.dump',
          '20261007T130000-124.dump.tmp',
          'private-object',
        ];
        if (order === 'descending') expectedNames.reverse();
        expect(enumeratedNames).toEqual(expectedNames);
        expect(report.complete).toBe(true);
        expect(report.probes.rootCapacity.data).toMatchObject({
          availableBytes: '1000',
          availableInodes: '5',
          usedInodePercent: '95',
        });
        expect(report.probes.currentImageTag.data).toBe(current);
        expect(report.probes.previousImageTag.data).toBe(previous);
        expect(
          report.probes.images.data.map(
            (row: { releaseSha: string }) => row.releaseSha,
          ),
        ).toEqual([current, previous]);
        expect(report.probes.containers.data[0].volumes).toEqual([
          'digital-autograph-staging-postgres',
        ]);
        const backups = report.probes.backupMetadata.data;
        expect(backups).toHaveLength(2);
        expect(
          Object.fromEntries(
            backups.map((row: { name: string }) => [row.name, row]),
          ),
        ).toEqual(
          Object.fromEntries(
            (
              [
                ['20261007T120000-123.dump', 'synthetic backup', true],
                ['20261007T130000-124.dump.tmp', 'incomplete', false],
              ] as const
            ).map(([name, contents, completedFilename]) => [
              name,
              {
                name,
                bytes: Buffer.byteLength(contents),
                modifiedAt: lstatSync(
                  path.join(f.directory, 'staging-backups', name),
                ).mtime.toISOString(),
                completedFilename,
              },
            ]),
          ),
        );
        expect(JSON.stringify(report)).not.toMatch(
          /DO-NOT-PRINT|synthetic backup|incomplete|private-object|"Env"|"Args"|"Source"|"Labels"/,
        );
        expect(readFileSync(path.join(f.directory, 'api.env'), 'utf8')).toBe(
          secret,
        );
        for (const { binary, args } of f.calls) {
          expect(['df', 'du', 'docker']).toContain(binary);
          if (binary === 'docker')
            expect(
              [
                'info',
                'system df',
                'image ls',
                'ps',
                'container inspect',
                'volume ls',
              ].some((allowed) => args.join(' ').startsWith(allowed)),
            ).toBe(true);
          expect(args).not.toEqual(expect.arrayContaining(['prune']));
          expect(
            args.some((arg) =>
              ['remove', 'restart', 'compose', 'logs'].includes(arg),
            ),
          ).toBe(false);
          expect(args.join(' ')).not.toMatch(/\.Config\.Env|\.Args|\.Source/);
        }
        expect(
          f.calls.some(
            (call) =>
              call.args.at(-1) === path.join('/runner path & literal', '_work'),
          ),
        ).toBe(true);
      } finally {
        read.mockRestore();
        f.cleanup();
      }
    },
  );

  it.each(['docker', 'df', 'du'])(
    'marks %s failure as incomplete while retaining successful probes and suppressing raw diagnostics',
    (failedBinary) => {
      const f = fixture();
      try {
        const report = f.collect((binary, args) =>
          binary === failedBinary
            ? { stdout: secret, stderr: secret, status: 1, signal: null }
            : f.run(binary, args),
        );
        expect(report.complete).toBe(false);
        expect(report.probes.currentImageTag.status).toBe('ok');
        expect(Object.values(report.probes)).toContainEqual({
          status: 'unavailable',
        });
        expect(JSON.stringify(report)).not.toContain(secret);
      } finally {
        f.cleanup();
      }
    },
  );

  it('does not pass untrusted container IDs to inspect and rejects malformed JSON', () => {
    const f = fixture();
    try {
      const report = f.collect((binary, args) =>
        binary === 'docker' && args[0] === 'ps'
          ? { stdout: '--format=secret', stderr: '', status: 0, signal: null }
          : binary === 'docker' && args[0] === 'image'
            ? { stdout: secret, stderr: '', status: 0, signal: null }
            : f.run(binary, args),
      );
      expect(report.complete).toBe(false);
      expect(report.probes.containers.status).toBe('unavailable');
      expect(report.probes.images.status).toBe('unavailable');
      expect(f.calls.some((call) => call.args[0] === 'container')).toBe(false);
      expect(JSON.stringify(report)).not.toContain(secret);
    } finally {
      f.cleanup();
    }
  });

  it.each([secret, 'x'.repeat(1000)])(
    'rejects invalid/oversized recorded tags without exposing them',
    (tag) => {
      const f = fixture();
      try {
        writeFileSync(path.join(f.directory, 'current-image-tag'), tag);
        const report = f.collect();
        expect(report.complete).toBe(false);
        expect(report.probes.currentImageTag.status).toBe('unavailable');
        expect(report.probes.previousImageTag.data).toBe(previous);
        expect(JSON.stringify(report)).not.toContain(tag);
      } finally {
        f.cleanup();
      }
    },
  );

  it('bounds probe failures from timeout/output overflow without echoing their errors', () => {
    const f = fixture();
    try {
      const report = f.collect(() => {
        throw new Error(secret);
      });
      expect(report.complete).toBe(false);
      expect(JSON.stringify(report)).not.toContain(secret);
    } finally {
      f.cleanup();
    }
  });

  it('shows CLI help without requiring Linux, Docker, VM files or credentials', () => {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(script), '--help'],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Read-only Linux inventory');
    expect(result.stderr).toBe('');
  });
});
