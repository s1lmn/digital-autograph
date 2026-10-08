import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const sha = /^[a-f0-9]{40}$/;
const imageId = /^sha256:[a-f0-9]{64}$/;
const containerId = /^[a-f0-9]{64}$/;
const timeout = 30_000;
const maxBuffer = 1024 * 1024;
const maxEntries = 1000;

export function collectInventory({
  runnerRoot = '/home/da-runner/actions-runner',
  stateRoot = '/var/lib/digital-autograph',
  run = (command, args) =>
    spawnSync(command, args, {
      encoding: 'utf8',
      timeout,
      maxBuffer,
      shell: false,
      env: { ...process.env, LC_ALL: 'C' },
    }),
} = {}) {
  const report = { version: 1, complete: true, probes: {} };
  function probe(name, operation) {
    try {
      report.probes[name] = { status: 'ok', data: operation() };
    } catch {
      // Command diagnostics and arbitrary file contents may contain credentials.
      report.complete = false;
      report.probes[name] = { status: 'unavailable' };
    }
  }
  function command(binary, args) {
    const result = run(binary, args);
    if (result.error || result.signal || result.status !== 0) throw new Error();
    return result.stdout.trim();
  }
  function rows(output) {
    const lines = output ? output.split('\n') : [];
    if (lines.length > maxEntries) throw new Error();
    return lines.map((line) => JSON.parse(line));
  }
  function capacity(directory) {
    const lines = command('df', [
      '-B1',
      '--output=size,used,avail,pcent,itotal,iused,iavail,ipcent',
      '--',
      directory,
    ]).split('\n');
    if (lines.length !== 2) throw new Error();
    const values = lines[1].trim().split(/\s+/);
    if (values.length !== 8 || values.some((v) => !/^\d+%?$/.test(v)))
      throw new Error();
    return Object.fromEntries(
      [
        'bytes',
        'usedBytes',
        'availableBytes',
        'usedPercent',
        'inodes',
        'usedInodes',
        'availableInodes',
        'usedInodePercent',
      ].map((key, index) => [key, values[index].replace('%', '')]),
    );
  }
  function usage(directory) {
    const output = command('du', ['-x', '-B1', '-s', '--', directory]);
    const match = /^(\d+)\t[^\n]+$/.exec(output);
    if (!match) throw new Error();
    return { allocatedBytes: match[1] };
  }
  function recordedTag(name) {
    const fd = openSync(
      path.join(stateRoot, name),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > 41) throw new Error();
      const buffer = Buffer.alloc(42);
      const length = readSync(fd, buffer, 0, buffer.length, 0);
      if (length > 41) throw new Error();
      const tag = buffer.subarray(0, length).toString('utf8').trim();
      if (!sha.test(tag)) throw new Error();
      return tag;
    } finally {
      closeSync(fd);
    }
  }

  probe('rootCapacity', () => capacity('/'));
  probe('rootConsumers', () => {
    const output = command('du', ['-x', '-B1', '--max-depth=1', '--', '/']);
    const lines = output.split('\n');
    if (lines.length > maxEntries) throw new Error();
    return lines.map((line) => {
      const match = /^(\d+)\t(\/(?:[a-zA-Z0-9_.+-]+)?)$/.exec(line);
      if (!match) throw new Error();
      return { directory: match[2], allocatedBytes: match[1] };
    });
  });
  for (const [name, directory] of Object.entries({
    runner: runnerRoot,
    runnerDiagnostics: path.join(runnerRoot, '_diag'),
    runnerWork: path.join(runnerRoot, '_work'),
    systemLogs: '/var/log',
    systemCache: '/var/cache',
    state: stateRoot,
    backups: path.join(stateRoot, 'staging-backups'),
  })) {
    probe(`${name}Capacity`, () => capacity(directory));
    probe(`${name}Usage`, () => usage(directory));
  }
  probe('currentImageTag', () => recordedTag('current-image-tag'));
  probe('previousImageTag', () => recordedTag('previous-image-tag'));
  probe('backupMetadata', () => {
    const directory = path.join(stateRoot, 'staging-backups');
    const entries = [];
    const handle = opendirSync(directory);
    try {
      let entry;
      while ((entry = handle.readSync())) {
        entries.push(entry);
        if (entries.length > maxEntries) throw new Error();
      }
    } finally {
      handle.closeSync();
    }
    return entries
      .filter((entry) => /^\d{8}T\d{6}-\d+\.dump(?:\.tmp)?$/.test(entry.name))
      .map((entry) => {
        const stat = lstatSync(path.join(directory, entry.name));
        if (!stat.isFile()) throw new Error();
        return {
          name: entry.name,
          bytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          completedFilename: entry.name.endsWith('.dump'),
        };
      });
  });
  probe('dockerRoot', () => {
    const directory = command('docker', [
      'info',
      '--format',
      '{{.DockerRootDir}}',
    ]);
    if (!/^\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(directory))
      throw new Error();
    return directory;
  });
  const dockerRoot = report.probes.dockerRoot.data;
  if (dockerRoot) {
    probe('dockerCapacity', () => capacity(dockerRoot));
    for (const section of ['', 'containers', 'image', 'volumes', 'buildkit']) {
      probe(`dockerUsage${section || 'Total'}`, () =>
        usage(path.join(dockerRoot, section)),
      );
    }
  }
  probe('dockerUsage', () =>
    rows(command('docker', ['system', 'df', '--format', '{{json .}}'])).map(
      (row) => {
        if (
          !['Images', 'Containers', 'Local Volumes', 'Build Cache'].includes(
            row.Type,
          ) ||
          !/^\d+$/.test(String(row.TotalCount)) ||
          !/^\d+$/.test(String(row.Active)) ||
          !/^[\d.]+\s*[kMGTPE]?B$/.test(row.Size) ||
          !/^[\d.]+\s*[kMGTPE]?B(?: \(\d+%\))?$/.test(row.Reclaimable)
        )
          throw new Error();
        return {
          type: row.Type,
          total: String(row.TotalCount),
          active: String(row.Active),
          size: row.Size,
          reclaimable: row.Reclaimable,
        };
      },
    ),
  );
  probe('images', () =>
    rows(
      command('docker', [
        'image',
        'ls',
        '--no-trunc',
        '--format',
        '{{json .}}',
      ]),
    ).map((row) => {
      if (!imageId.test(row.ID) || !/^[\d.]+\s*[kMGTPE]?B$/.test(row.Size))
        throw new Error();
      const release =
        /^cr\.yandex\/[a-z0-9]+\/digital-autograph\/(api|web|worker|migration)$/.exec(
          row.Repository,
        );
      return {
        id: row.ID,
        size: row.Size,
        ...(release && sha.test(row.Tag)
          ? { service: release[1], releaseSha: row.Tag }
          : {}),
      };
    }),
  );
  probe('containers', () => {
    const ids = command('docker', ['ps', '-aq', '--no-trunc'])
      .split('\n')
      .filter(Boolean);
    if (ids.length > maxEntries || ids.some((id) => !containerId.test(id)))
      throw new Error();
    if (!ids.length) return [];
    // Project only these fields in Docker itself, never retrieve Env, Args or arbitrary labels.
    const format =
      '{"id":{{json .Id}},"imageId":{{json .Image}},"status":{{json .State.Status}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"volumes":[{{range $i, $m := .Mounts}}{{if $i}},{{end}}{"type":{{json $m.Type}}{{if eq $m.Type "volume"}},"name":{{json $m.Name}}{{end}}}{{end}}]}';
    return rows(
      command('docker', ['container', 'inspect', '--format', format, ...ids]),
    ).map((row) => {
      if (
        !containerId.test(row.id) ||
        !imageId.test(row.imageId) ||
        ![
          'created',
          'running',
          'paused',
          'restarting',
          'removing',
          'exited',
          'dead',
        ].includes(row.status) ||
        !Array.isArray(row.volumes)
      )
        throw new Error();
      return {
        id: row.id,
        imageId: row.imageId,
        status: row.status,
        ...(['api', 'web', 'worker', 'migration', 'postgres', 'caddy'].includes(
          row.service,
        )
          ? { service: row.service }
          : {}),
        volumes: row.volumes
          .filter((mount) => mount.type === 'volume')
          .map((mount) => {
            if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,255}$/.test(mount.name))
              throw new Error();
            return mount.name;
          }),
      };
    });
  });
  probe('volumes', () =>
    rows(command('docker', ['volume', 'ls', '--format', '{{json .}}'])).map(
      (row) => {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,255}$/.test(row.Name))
          throw new Error();
        return { name: row.Name };
      },
    ),
  );
  return report;
}

export function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(
      'Usage: node staging-disk-inventory.mjs [--runner-root /absolute/path]\nRead-only Linux inventory; exit 1 means incomplete evidence.\n',
    );
    return 0;
  }
  if (process.platform !== 'linux') {
    process.stderr.write(
      'Inventory requires Linux; no probes were executed.\n',
    );
    return 2;
  }
  let runnerRoot;
  if (args.length) {
    if (
      args.length !== 2 ||
      args[0] !== '--runner-root' ||
      !path.isAbsolute(args[1]) ||
      /[\r\n\0]/.test(args[1])
    ) {
      process.stderr.write('Use --help for supported arguments.\n');
      return 2;
    }
    runnerRoot = args[1];
  }
  const report = collectInventory({ runnerRoot });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.complete ? 0 : 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main();
}
