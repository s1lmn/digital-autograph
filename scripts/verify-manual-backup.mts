import { hostname } from 'node:os';
// Explicit off-VM recovery rehearsal. Never restores over the server DB or source bucket.
import { spawnSync } from 'node:child_process';
import { openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fingerprint, fileHash } from '../deploy/manual-deploy.mjs';
import {
  S3Client,
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteBucketCommand,
  verifyPrivateFileBackup,
  restoreFilesToLoopback,
} from '../packages/integrations/src/file-backup';

const run = (args: string[], input?: string | number) => {
  const r = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 8 * 1024 * 1024,
    ...(typeof input === 'number'
      ? { stdio: [input, 'pipe', 'pipe'] as [number, 'pipe', 'pipe'] }
      : { input }),
  });
  if (r.status !== 0 || r.error) throw Error('Isolated restore command failed');
  return r.stdout;
};
let name: string | undefined,
  volume: string | undefined,
  client: S3Client | undefined,
  bucket: string | undefined;
let restoredKeys: string[] = [];
let publishProof: (() => void) | undefined;
try {
  const [recordFile, archive, files, configFile, proofFile] =
    process.argv.slice(2);
  if (!recordFile || !archive || !files || !configFile || !proofFile)
    throw Error('Explicit archive/source receipt/config required');
  const record = JSON.parse(readFileSync(recordFile, 'utf8')),
    config = JSON.parse(readFileSync(configFile, 'utf8'));
  if (
    !/^sha256:[a-f0-9]{64}$/.test(config.postgresImage) ||
    !config.reviewedBy ||
    fileHash(archive) !== record.databaseArchiveSha256
  )
    throw Error('Verified archive and reviewer required');
  if (
    typeof record.sourceHostname !== 'string' ||
    record.sourceHostname === hostname()
  )
    throw Error('Restore rehearsal must run outside the source server');
  const endpoint = new URL(config.endpoint);
  if (
    endpoint.protocol !== 'http:' ||
    endpoint.hostname !== '127.0.0.1' ||
    !endpoint.port ||
    endpoint.pathname !== '/' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw Error('Loopback restore only');
  const manifest = await verifyPrivateFileBackup(files);
  name = 'destka-restore-' + randomUUID();
  volume = name + '-data';
  run([
    'run',
    '--detach',
    '--pull',
    'never',
    '--name',
    name,
    '--network',
    'none',
    '--memory',
    '512m',
    '--volume',
    volume + ':/var/lib/postgresql/data',
    '--env',
    'POSTGRES_DB=restore',
    '--env',
    'POSTGRES_HOST_AUTH_METHOD=trust',
    config.postgresImage,
  ]);
  let ready = false;
  for (let i = 0; i < 30; i++) {
    const r = spawnSync(
      'docker',
      ['exec', name, 'pg_isready', '-U', 'postgres', '-d', 'restore'],
      { stdio: 'ignore' },
    );
    if (r.status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready) throw Error('Restore PostgreSQL unavailable');
  const fd = openSync(archive, 'r');
  try {
    run(
      [
        'exec',
        '-i',
        name,
        'pg_restore',
        '-U',
        'postgres',
        '-d',
        'restore',
        '--exit-on-error',
        '--single-transaction',
        '--no-owner',
        '--no-acl',
      ],
      fd,
    );
  } finally {
    closeSync(fd);
  }
  const snapshot = JSON.parse(
    run(
      [
        'exec',
        '-i',
        name,
        'psql',
        '-X',
        '-qAt',
        '-U',
        'postgres',
        '-d',
        'restore',
      ],
      readFileSync('deploy/database-state.sql', 'utf8'),
    ),
  );
  if (fingerprint(snapshot) !== record.baselineHash)
    throw Error('Restored counts/migration hashes mismatch');
  bucket = 'destka-restore-' + randomUUID();
  client = new S3Client({
    endpoint: endpoint.origin,
    region: 'us-east-1',
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  await client.send(new CreateBucketCommand({ Bucket: bucket }), {
    abortSignal: AbortSignal.timeout(10000),
  });
  restoredKeys = manifest.manifest.objects.map((o) => o.key);
  const fileProof = await restoreFilesToLoopback({
    ...config,
    bucket,
    directory: files,
  });
  publishProof = () =>
    writeFileSync(
      proofFile,
      JSON.stringify(
        {
          databaseArchiveSha256: record.databaseArchiveSha256,
          baselineHash: record.baselineHash,
          filesManifestSha256: fileProof.filesManifestSha256,
          sourceBucket: manifest.manifest.bucket,
          sourceEndpoint: manifest.manifest.sourceEndpoint,
          offVm: true,
          databaseRestorePassed: true,
          filesRestorePassed: true,
          reviewedBy: config.reviewedBy,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
} catch {
  console.error(
    'Off-VM recovery proof refused/failed; no server/source restore performed.',
  );
  process.exitCode = 1;
} finally {
  try {
    if (client && bucket) {
      for (const Key of restoredKeys)
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key }), {
          abortSignal: AbortSignal.timeout(10000),
        });
      await client.send(new DeleteBucketCommand({ Bucket: bucket }), {
        abortSignal: AbortSignal.timeout(10000),
      });
    }
    if (name) run(['rm', '--force', name]);
    if (volume) run(['volume', 'rm', volume]);
  } catch {
    console.error('Temporary local restore cleanup needs operator inspection.');
    process.exitCode = 1;
  }
  client?.destroy();
}

if (!process.exitCode && publishProof) {
  try {
    publishProof();
    console.log(
      'Off-VM database and private-file restore verified. No source was modified.',
    );
  } catch {
    console.error('Recovery proof publication failed; no promotion allowed.');
    process.exitCode = 1;
  }
}
