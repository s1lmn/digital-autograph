import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = new URL(
  '../../../deploy/staging-disk-inventory.mjs',
  import.meta.url,
);
const { collectInventory } = await import(script.href);
const dockerReady =
  process.platform === 'linux' &&
  spawnSync('docker', ['info', '--format', '{{.DockerRootDir}}'], {
    encoding: 'utf8',
    timeout: 5000,
  }).status === 0;

describe.skipIf(
  process.platform !== 'linux' || (!dockerReady && !process.env.GITHUB_ACTIONS),
)('Linux inventory with real GNU tools and Docker metadata', () => {
  it('parses actual Docker projections and filesystem counters without inspecting secrets or modifying containers', () => {
    expect(dockerReady).toBe(true);
    const directory = mkdtempSync(
      path.join(os.tmpdir(), 'da-inventory-linux-'),
    );
    try {
      mkdirSync(path.join(directory, 'staging-backups'));
      writeFileSync(path.join(directory, 'current-image-tag'), 'a'.repeat(40));
      writeFileSync(path.join(directory, 'previous-image-tag'), 'b'.repeat(40));
      const report = collectInventory({
        stateRoot: directory,
        runnerRoot: directory,
        run: (binary: string, args: string[]) => {
          // Disk scans use only the owned fixture; Docker probes exercise the real daemon read-only.
          const actualArgs =
            binary === 'docker' ? args : [...args.slice(0, -1), directory];
          return spawnSync(binary, actualArgs, {
            encoding: 'utf8',
            timeout: 30000,
            maxBuffer: 1024 * 1024,
            env: { ...process.env, LC_ALL: 'C' },
          });
        },
      });
      for (const name of [
        'rootCapacity',
        'runnerUsage',
        'dockerRoot',
        'dockerUsage',
        'images',
        'containers',
        'volumes',
      ]) {
        expect(report.probes[name].status, name).toBe('ok');
      }
      expect(
        Number(report.probes.rootCapacity.data.availableInodes),
      ).toBeGreaterThan(0);
      expect(
        Number(report.probes.runnerUsage.data.allocatedBytes),
      ).toBeGreaterThan(0);
      expect(report.probes.containers.data.length).toBeGreaterThan(0);
      for (const container of report.probes.containers.data) {
        expect(Object.keys(container).sort()).toEqual(
          ['id', 'imageId', 'status', 'volumes']
            .concat(container.service ? ['service'] : [])
            .sort(),
        );
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects unsupported CLI arguments before probing the VM', () => {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(script), '--cleanup'],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('supported arguments');
  });
  it('returns nonzero and structured incomplete evidence when executables are unavailable', () => {
    const result = spawnSync(process.execPath, [fileURLToPath(script)], {
      encoding: 'utf8',
      env: { ...process.env, PATH: '/nonexistent-da-inventory-path' },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    const report = JSON.parse(result.stdout);
    expect(report.complete).toBe(false);
    expect(report.probes.rootCapacity).toEqual({ status: 'unavailable' });
    expect(report.probes.dockerRoot).toEqual({ status: 'unavailable' });
  });
});
