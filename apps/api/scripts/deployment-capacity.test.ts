import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkCapacity,
  minimumBytes,
  minimumInodes,
  parseAvailable,
  retainImages,
  retentionPlan,
} from '../../../deploy/host-capacity.mjs';

const current = 'a'.repeat(40);
const previous = 'b'.repeat(40);
const old = 'c'.repeat(40);
const running = 'd'.repeat(40);
const base = 'cr.yandex/registry/digital-autograph/';
const id = (number: number) =>
  `sha256:${number.toString(16).padStart(64, '0')}`;
const images = [current, previous, old, running].flatMap((tag, release) =>
  ['api', 'web', 'worker', 'migration'].map((target, index) => ({
    Id: id(release * 4 + index + 1),
    RepoTags: [`${base}${target}:${tag}`],
  })),
);

describe('deployment capacity fails closed without mutation', () => {
  it('rejects byte/inode header mixups rather than treating byte capacity as free inodes', () => {
    expect(() =>
      checkCapacity(['/root'], () => `Avail\n${minimumBytes}`),
    ).toThrow('Invalid filesystem');
  });
  it('accepts enough bytes/inodes across every storage path', () => {
    const paths: string[] = [];
    checkCapacity(
      ['/root', '/docker', '/runner'],
      (_: string, args: string[]) => {
        paths.push(args.at(-1)!);
        return args.includes('--output=iavail')
          ? `IFree\n${minimumInodes}`
          : `Avail\n${minimumBytes}`;
      },
    );
    expect(paths).toEqual([
      '/root',
      '/root',
      '/docker',
      '/docker',
      '/runner',
      '/runner',
    ]);
  });
  it.each(['bytes', 'inodes', 'command', 'malformed'])(
    'rejects %s failures before continuing deployment',
    (failure) => {
      let mutated = false;
      expect(() => {
        checkCapacity(['/root'], (_: string, args: string[]) => {
          if (failure === 'command') throw new Error('command unavailable');
          if (failure === 'malformed') return 'unparseable';
          return args.includes('--output=iavail')
            ? `IFree\n${failure === 'inodes' ? 0 : minimumInodes}`
            : `Avail\n${failure === 'bytes' ? minimumBytes - 1n : minimumBytes}`;
        });
        mutated = true;
      }).toThrow();
      expect(mutated).toBe(false);
    },
  );
  it.each([
    'Avail\n-1',
    'Avail\n0\n1',
    'Avail\nNaN',
    '',
    'garbage\n999999999999',
  ])('rejects invalid df output %j', (output) => {
    expect(() => parseAvailable(output)).toThrow();
  });
  it('enforces an increased image size budget', () => {
    expect(() =>
      checkCapacity(
        ['/root'],
        (_: string, args: string[]) =>
          args.includes('--output=iavail')
            ? `IFree\n${minimumInodes}`
            : `Avail\n${minimumBytes}`,
        minimumBytes + 1n,
      ),
    ).toThrow('Insufficient');
  });
});

describe('project-specific rollback-safe image retention', () => {
  it('preserves complete current/previous sets, all container-used IDs and third-party tags', () => {
    const inventory = [
      ...images,
      {
        Id: id(50),
        RepoTags: ['postgres:17-alpine', 'third-party/image:latest'],
      },
      { Id: id(51), RepoTags: [`${base}api:latest`] },
      { Id: id(52), RepoTags: null },
      { Id: images[0].Id, RepoTags: [`${base}api:${'e'.repeat(40)}`] },
    ];
    const plan = retentionPlan(
      inventory,
      images.slice(12).map((image) => ({ Image: image.Id })),
      'registry',
      current,
      previous,
    );
    expect(plan).toEqual(
      images
        .slice(8, 12)
        .flatMap((image) => image.RepoTags)
        .sort(),
    );
  });
  it('fails closed when rollback images or inventory are incomplete', () => {
    expect(() =>
      retentionPlan(images.slice(1), [], 'registry', current, previous),
    ).toThrow('incomplete');
    expect(() =>
      retentionPlan(
        images,
        [{ Image: 'unresolved' }],
        'registry',
        current,
        previous,
      ),
    ).toThrow();
    expect(() =>
      retentionPlan(images, [], '../other', current, previous),
    ).toThrow();
    expect(() =>
      retentionPlan(images, [], 'registry', 'main', previous),
    ).toThrow();
  });
  it('supports first release without a previous tag and removes tags only, never volumes', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'da-retention-'));
    const commands: string[][] = [];
    try {
      writeFileSync(path.join(directory, 'current-image-tag'), current);
      const removed = retainImages(
        directory,
        'registry',
        (_: string, args: string[]) => {
          commands.push(args);
          if (args[0] === 'container') return '1'.repeat(64);
          if (args[0] === 'inspect') return images[12].Id;
          if (args[1] === 'ls')
            return images.map((image) => image.Id).join('\n');
          if (args[1] === 'inspect') return JSON.stringify(images);
          return '';
        },
      );
      expect(removed).toBe(11);
      expect(commands.filter((args) => args[1] === 'rm')).toHaveLength(11);
      expect(
        commands.every(
          (args) =>
            !args.includes('volume') &&
            !args.includes('prune') &&
            !args.includes('--force'),
        ),
      ).toBe(true);
      expect(
        commands
          .filter((args) => args[1] === 'rm')
          .every(
            (args) =>
              args.length === 4 && args[2] === '--' && args[3].startsWith(base),
          ),
      ).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('does not delete anything on Docker command/JSON errors', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'da-retention-'));
    let deleted = false;
    try {
      writeFileSync(path.join(directory, 'current-image-tag'), current);
      expect(() =>
        retainImages(directory, 'registry', (_: string, args: string[]) => {
          if (args[1] === 'rm') deleted = true;
          return 'not an inventory';
        }),
      ).toThrow();
      expect(deleted).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('preserves an obsolete image newly referenced by a container before deletion', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'da-retention-'));
    const removed: string[] = [];
    let containerReads = 0;
    try {
      writeFileSync(path.join(directory, 'current-image-tag'), current);
      writeFileSync(path.join(directory, 'previous-image-tag'), previous);
      retainImages(directory, 'registry', (_: string, args: string[]) => {
        if (args[0] === 'container') return '1'.repeat(64);
        if (args[0] === 'inspect')
          return images[containerReads++ === 0 ? 12 : 8].Id;
        if (args[1] === 'ls') return images.map((image) => image.Id).join('\n');
        if (args[1] === 'inspect') return JSON.stringify(images);
        if (args[1] === 'rm') removed.push(args[3]);
        return '';
      });
      expect(removed).not.toContain(`${base}api:${old}`);
      expect(removed).toContain(`${base}web:${old}`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
