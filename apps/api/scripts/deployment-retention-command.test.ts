import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync: spawn }));
import { retainImages } from '../../../deploy/host-capacity.mjs';

const current = 'a'.repeat(40);
const previous = 'b'.repeat(40);
const obsolete = 'c'.repeat(40);
const images = [current, previous, obsolete].flatMap((tag, release) =>
  ['api', 'web', 'worker', 'migration'].map((target, index) => ({
    Id: `sha256:${String(release * 4 + index + 1).padStart(64, '0')}`,
    RepoTags: [`cr.yandex/registry/digital-autograph/${target}:${tag}`],
  })),
);
let directory: string;
let removalDurationMs: number;
let removalExit: number;

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'da-retention-command-'));
  writeFileSync(path.join(directory, 'current-image-tag'), current);
  writeFileSync(path.join(directory, 'previous-image-tag'), previous);
  removalDurationMs = 31_000;
  removalExit = 0;
  spawn.mockReset();
  spawn.mockImplementation(
    (program: string, args: string[], options: { timeout: number }) => {
      expect(program).toBe('docker');
      if (args[1] === 'rm') {
        if (options.timeout < removalDurationMs)
          return {
            status: null,
            error: Object.assign(new Error('synthetic timeout'), {
              code: 'ETIMEDOUT',
            }),
            stdout: 'sensitive output must not be echoed',
            stderr: 'sensitive error must not be echoed',
          };
        return {
          status: removalExit,
          stdout: '',
          stderr: 'sensitive error must not be echoed',
        };
      }
      expect(options.timeout).toBe(30_000);
      if (args[0] === 'container') return { status: 0, stdout: '' };
      if (args[1] === 'ls')
        return {
          status: 0,
          stdout: images.map((image) => image.Id).join('\n'),
        };
      return { status: 0, stdout: JSON.stringify(images) };
    },
  );
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe('bounded Docker image removal command', () => {
  it('allows a removal exceeding the inventory timeout without relaxing reads or protected sets', () => {
    expect(retainImages(directory, 'registry')).toBe(4);
    const removals = spawn.mock.calls.filter(([, args]) => args[1] === 'rm');
    expect(removals.map(([, args]) => args)).toEqual(
      images
        .slice(8)
        .map((image) => ['image', 'rm', '--', image.RepoTags[0]])
        .sort((a, b) => a[3].localeCompare(b[3])),
    );
    expect(removals.every(([, , options]) => options.timeout === 300_000)).toBe(
      true,
    );
  });

  it('still aborts after the bounded removal timeout without proceeding to another tag', () => {
    removalDurationMs = 300_001;
    expect(() => retainImages(directory, 'registry')).toThrow(
      /^Capacity\/retention command failed: docker image rm \(timeout after 300000 ms\)$/,
    );
    expect(
      spawn.mock.calls.filter(([, args]) => args[1] === 'rm'),
    ).toHaveLength(1);
  });

  it('stops on a nonzero removal exit without leaking output or attempting another tag', () => {
    removalExit = 1;
    expect(() => retainImages(directory, 'registry')).toThrow(
      /^Capacity\/retention command failed: docker image rm \(exit 1\)$/,
    );
    expect(
      spawn.mock.calls.filter(([, args]) => args[1] === 'rm'),
    ).toHaveLength(1);
  });
});
