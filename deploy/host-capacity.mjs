import { spawnSync } from 'node:child_process';
import console from 'node:console';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

// Observed four-image set: ~2.92 GB. Allow two copies for download/unpack,
// plus >=1 GiB for backup, migration, runner logs and transient writes.
export const minimumBytes = 7n * 1024n ** 3n;
export const minimumInodes = 200_000n;
const sha = /^[0-9a-f]{40}$/;
const imageId = /^sha256:[0-9a-f]{64}$/;
const targets = ['api', 'web', 'worker', 'migration'];
class CapacityError extends Error {}

function command(program, args) {
  const result = spawnSync(program, args, {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, LC_ALL: 'C' },
  });
  if (result.error || result.status !== 0)
    throw new CapacityError(`Capacity/retention command failed: ${program}`);
  return result.stdout;
}

export function parseAvailable(output, header = 'Avail') {
  const lines = output.trim().split(/\r?\n/);
  if (
    lines.length !== 2 ||
    lines[0].trim() !== header ||
    !/^\s*\d+\s*$/.test(lines[1])
  )
    throw new CapacityError('Invalid filesystem capacity response');
  return BigInt(lines[1].trim());
}

export function checkCapacity(
  paths,
  run = command,
  requiredBytes = minimumBytes,
) {
  for (const location of paths) {
    const bytes = parseAvailable(
      run('df', ['-B1', '--output=avail', '--', location]),
    );
    const inodes = parseAvailable(
      run('df', ['--output=iavail', '--', location]),
      'IFree',
    );
    if (bytes < requiredBytes || inodes < minimumInodes)
      throw new CapacityError(
        `Insufficient deployment capacity: available bytes=${bytes}, inodes=${inodes}; required bytes=${requiredBytes}, inodes=${minimumInodes}. Application and database were not changed.`,
      );
  }
}

function recordedTag(state, name, optional = false) {
  const file = path.join(state, name);
  if (optional && !existsSync(file)) return undefined;
  const tag = readFileSync(file, 'utf8').trim();
  if (!sha.test(tag)) throw new CapacityError('Invalid recorded release tag');
  return tag;
}

function prefix(registry) {
  if (!/^[a-z0-9-]+$/.test(registry))
    throw new CapacityError('Invalid registry ID');
  return `cr.yandex/${registry}/digital-autograph/`;
}

export function retentionPlan(images, containers, registry, current, previous) {
  const base = prefix(registry);
  if (!sha.test(current) || (previous !== undefined && !sha.test(previous)))
    throw new CapacityError('Invalid protected release tag');
  if (!Array.isArray(images) || !Array.isArray(containers))
    throw new CapacityError('Invalid Docker inventory');
  const protectedIds = new Set();
  for (const container of containers) {
    if (!imageId.test(container.Image))
      throw new CapacityError('Invalid container image ID');
    protectedIds.add(container.Image); // Include stopped containers as well.
  }
  const refs = new Map();
  for (const image of images) {
    if (
      !imageId.test(image.Id) ||
      (image.RepoTags !== null && !Array.isArray(image.RepoTags)) ||
      image.RepoTags?.some((tag) => typeof tag !== 'string')
    )
      throw new CapacityError('Invalid image inventory');
    for (const ref of image.RepoTags ?? []) refs.set(ref, image.Id);
  }
  // Missing rollback images fail closed before any deletion.
  for (const tag of [current, previous].filter(Boolean)) {
    for (const target of targets) {
      const id = refs.get(`${base}${target}:${tag}`);
      if (!id)
        throw new CapacityError('Protected release image set is incomplete');
      protectedIds.add(id);
    }
  }
  const candidates = [];
  for (const [ref, id] of refs) {
    if (!ref.startsWith(base) || protectedIds.has(id)) continue;
    const suffix = ref.slice(base.length);
    const match = /^(api|web|worker|migration):([0-9a-f]{40})$/.exec(suffix);
    if (match && match[2] !== current && match[2] !== previous)
      candidates.push(ref);
  }
  return candidates.sort();
}

function inventory(run) {
  const imageIds = run('docker', ['image', 'ls', '--quiet', '--no-trunc'])
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const containerIds = run('docker', [
    'container',
    'ls',
    '--all',
    '--quiet',
    '--no-trunc',
  ])
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (
    imageIds.some((id) => !imageId.test(id)) ||
    containerIds.some((id) => !/^[0-9a-f]{64}$/.test(id))
  )
    throw new CapacityError('Invalid Docker inventory identifiers');
  const images = imageIds.length
    ? JSON.parse(
        run('docker', ['image', 'inspect', '--', ...new Set(imageIds)]),
      )
    : [];
  // Read only image IDs, never container Config.Env or runtime secrets.
  const containers = containerIds.map((id) => ({
    Image: run('docker', ['inspect', '--format', '{{.Image}}', id]).trim(),
  }));
  return { images, containers };
}

export function retainImages(state, registry, run = command) {
  const current = recordedTag(state, 'current-image-tag');
  const previous = recordedTag(state, 'previous-image-tag', true);
  const { images, containers } = inventory(run);
  const plan = retentionPlan(images, containers, registry, current, previous);
  // Never force, prune, delete containers/volumes, or remove image IDs.
  let removed = 0;
  for (const ref of plan) {
    if (
      recordedTag(state, 'current-image-tag') !== current ||
      recordedTag(state, 'previous-image-tag', true) !== previous
    )
      throw new CapacityError('Release state changed during retention; stop');
    // Recheck container IDs/aliases immediately before each deletion. Untagging
    // an image with multiple aliases can otherwise succeed while it is in use.
    const latest = inventory(run);
    if (
      !retentionPlan(
        latest.images,
        latest.containers,
        registry,
        current,
        previous,
      ).includes(ref)
    )
      continue;
    run('docker', ['image', 'rm', '--', ref]);
    removed++;
  }
  return removed;
}

function existingParent(location) {
  while (!existsSync(location)) {
    const parent = path.dirname(location);
    if (parent === location)
      throw new CapacityError('Capacity path unavailable');
    location = parent;
  }
  return location;
}

function preflight(state, root, registry) {
  let requiredBytes = minimumBytes;
  // Grow the budget automatically if the last healthy image set grew.
  if (existsSync(path.join(state, 'current-image-tag'))) {
    const tag = recordedTag(state, 'current-image-tag');
    const base = prefix(registry);
    const sizes = JSON.parse(
      command('docker', [
        'image',
        'inspect',
        '--',
        ...targets.map((target) => `${base}${target}:${tag}`),
      ]),
    );
    if (
      !Array.isArray(sizes) ||
      sizes.length !== targets.length ||
      sizes.some(
        (image) => !Number.isSafeInteger(image.Size) || image.Size <= 0,
      )
    )
      throw new CapacityError('Invalid protected image sizes');
    const estimate =
      sizes.reduce((sum, image) => sum + BigInt(image.Size), 0n) * 2n +
      1024n ** 3n;
    if (estimate > requiredBytes) requiredBytes = estimate;
  }
  const dockerRoot = command('docker', [
    'info',
    '--format',
    '{{.DockerRootDir}}',
  ]).trim();
  if (!path.isAbsolute(dockerRoot) || dockerRoot.includes('\n'))
    throw new CapacityError('Invalid Docker storage path');
  checkCapacity(
    [root, state, dockerRoot, '/var/lib/containerd', '/home/da-runner'].map(
      existingParent,
    ),
    command,
    requiredBytes,
  );
  console.log(
    `Deployment capacity preflight passed (required bytes=${requiredBytes}, inodes=${minimumInodes})`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [operation, state, root, registry] = process.argv.slice(2);
    if (!state || !root || !registry)
      throw new CapacityError('Missing capacity arguments');
    if (operation === 'preflight') preflight(state, root, registry);
    else if (operation === 'retain')
      console.log(
        `Post-success retention removed ${retainImages(state, registry)} obsolete project tags`,
      );
    else throw new CapacityError('Invalid capacity operation');
  } catch (error) {
    // Inventory/CLI stdout, stderr and environment values are never logged.
    console.error(
      error instanceof CapacityError
        ? error.message
        : 'Capacity/retention validation failed; refusing operation',
    );
    process.exitCode = 1;
  }
}
