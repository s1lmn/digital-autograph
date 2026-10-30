import { hostname } from 'node:os';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { spawnSync } from 'node:child_process';
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  statSync,
  realpathSync,
  openSync,
  fsyncSync,
  closeSync,
  renameSync,
  readSync,
  fstatSync,
  constants,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL, URL } from 'node:url';

export const targets = ['api', 'web', 'worker', 'migration'];
const digest = /^sha256:[a-f0-9]{64}$/;
const hash = /^[a-f0-9]{64}$/;
export const sha256 = (value) =>
  createHash('sha256').update(value).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export const fingerprint = (value) => sha256(JSON.stringify(canonical(value)));
export function scram(password) {
  const salt = randomBytes(16),
    salted = pbkdf2Sync(password, salt, 4096, 32, 'sha256');
  const client = createHmac('sha256', salted).update('Client Key').digest();
  const server = createHmac('sha256', salted)
    .update('Server Key')
    .digest('base64');
  return `SCRAM-SHA-256$4096:${salt.toString('base64')}$${createHash('sha256').update(client).digest('base64')}:${server}`;
}
export function validateManifest(m) {
  if (
    m?.schemaVersion !== 1 ||
    !/^[a-f0-9]{40}$/.test(m.sourceSha) ||
    !/^[a-z0-9-]{8,64}$/.test(m.operation) ||
    !/^[a-z][a-z0-9_]{2,62}$/.test(m.database) ||
    m.project !== 'digital-autograph' ||
    m.environment !== 'staging' ||
    !/^[a-z0-9]{20}$/.test(m.instanceId) ||
    !/^[a-z0-9]{20}$/.test(m.runtimeServiceAccountId)
  )
    throw Error('Invalid manual manifest');
  for (const app of targets)
    if (
      !digest.test(m.images?.[app]?.id) ||
      !hash.test(m.images[app].archiveSha256) ||
      m.images[app].archive !== `${app}.tar`
    )
      throw Error('Immutable image/archive required');
  for (const app of ['postgres', 'caddy'])
    if (!digest.test(m.infrastructure?.[app]))
      throw Error('Existing infrastructure image IDs required');
  for (const name of ['web', 'api'])
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(m.domains?.[name]))
      throw Error('Invalid origin');
  if (
    !hash.test(m.toolBundleSha256) ||
    !Array.isArray(m.migrations) ||
    m.migrations.length !== 24 ||
    m.migrations.some(
      (x) => !hash.test(x.hash) || !Number.isSafeInteger(x.created_at),
    )
  )
    throw Error('Proof/tool/migration hashes required');
  if (
    !Number.isInteger(m.drainSeconds) ||
    m.drainSeconds < 330 ||
    m.drainSeconds > 3600
  )
    throw Error('Invalid drain bound');
  if (
    !['Caddyfile', 'Caddyfile.destka'].includes(m.caddyConfig) ||
    (m.caddyConfig === 'Caddyfile.destka' &&
      (m.domains.web !== 'destka.ru' ||
        m.domains.api !== 'api.destka.ru' ||
        m.publicDomainApproved !== true))
  )
    throw Error('Separate domain approval required');
  if (
    !Array.isArray(m.runtimeSecretIds) ||
    m.runtimeSecretIds.length !== 2 ||
    new Set(m.runtimeSecretIds).size !== 2 ||
    m.runtimeSecretIds.some((id) => !/^[a-z0-9]{20}$/.test(id))
  )
    throw Error('Exact two runtime secret IDs required');
  if (
    [m.domains.web, m.domains.api].some(
      (h) => h === 'destka.ru' || h.endsWith('.destka.ru'),
    ) &&
    (m.publicDomainApproved !== true || m.caddyConfig !== 'Caddyfile.destka')
  )
    throw Error('Separate DNS/origin approval required');
  return m;
}
export function validateMetadataProof(
  p,
  instanceId,
  runtimeServiceAccountId,
  runtimeSecretIds,
) {
  if (
    p?.instanceId !== instanceId ||
    !Number.isFinite(Date.parse(p.observedAt)) ||
    Math.abs(Date.now() - Date.parse(p.observedAt)) > 24 * 3600000 ||
    ['aws_v1_http_token', 'aws_v2_http_token', 'gce_http_token'].some(
      (key) => p.metadata_options?.[key] !== 'DISABLED',
    )
  )
    throw Error(
      'All metadata credential dialects must be disabled; no token probing',
    );
  if (
    p.runtimeServiceAccountId !== runtimeServiceAccountId ||
    !p.effectiveAuthorityReviewedBy ||
    !Array.isArray(p.lockbox) ||
    p.lockbox.length !== 2 ||
    fingerprint(p.lockbox.map((s) => s.secretId).sort()) !==
      fingerprint([...runtimeSecretIds].sort()) ||
    p.lockbox.some(
      (s) =>
        !s.secretId ||
        !Array.isArray(s.bindings) ||
        s.bindings.some(
          (b) =>
            b.subject?.id === runtimeServiceAccountId ||
            ['allUsers', 'allAuthenticatedUsers'].includes(b.subject?.id),
        ),
    )
  )
    throw Error(
      'Runtime Lockbox bindings must be removed and inherited authority reviewed',
    );
}
export function validateRuntime(model, m) {
  const passwords = [];
  for (const [app, role] of [
    ['api', 'da_api'],
    ['worker', 'da_worker'],
    ['migration', 'da_migrator'],
  ]) {
    const env = model.services[app].environment,
      u = new URL(env.DATABASE_URL);
    if (
      !['postgres:', 'postgresql:'].includes(u.protocol) ||
      u.hostname !== 'postgres' ||
      (u.port && u.port !== '5432') ||
      decodeURIComponent(u.username) !== role ||
      decodeURIComponent(u.pathname.slice(1)) !== m.database ||
      u.hash ||
      [...u.searchParams].some(
        ([k, v]) => k !== 'sslmode' || v !== 'disable',
      ) ||
      decodeURIComponent(u.password).length < 32
    )
      throw Error('Separate restricted runtime/migration DSNs required');
    passwords.push(decodeURIComponent(u.password));
    if (
      app !== 'migration' &&
      (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY)
    )
      throw Error('Explicit storage credentials required');
  }
  if (
    new Set(passwords).size !== 3 ||
    passwords.includes(model.services.postgres.environment.POSTGRES_PASSWORD) ||
    String(model.services.api.environment.DISABLE_NEW_PAYMENTS) !== 'true' ||
    String(model.services.api.environment.DISABLE_FREE_CLAIMS) !== 'false' ||
    model.services.postgres.environment.POSTGRES_DB !== m.database ||
    model.services.postgres.environment.POSTGRES_USER === 'da_api' ||
    model.services.postgres.environment.POSTGRES_USER === 'da_worker' ||
    model.services.postgres.environment.POSTGRES_USER === 'da_migrator'
  )
    throw Error('Unsafe payment/bootstrap configuration');
  const old = model.services.api.environment;
  if (old.ENABLE_TEST_AUTH_SEAM === 'true') throw Error('Test auth prohibited');
  return passwords;
}
function execute(program, args, { input, timeout = 60000, stdoutFile } = {}) {
  const fd = stdoutFile ? openSync(stdoutFile, 'wx', 0o600) : undefined;
  let r;
  try {
    r = spawnSync(program, args, {
      input,
      timeout,
      encoding: 'utf8',
      stdio: fd === undefined ? undefined : ['pipe', fd, 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    });
  } finally {
    if (fd !== undefined) {
      fsyncSync(fd);
      closeSync(fd);
    }
  }
  if (r.error || r.status !== 0)
    throw Error('Command failed; output suppressed to protect credentials');
  return r.stdout;
}
export function privateFile(file, uid = 0) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = fstatSync(fd);
    if (
      !st.isFile() ||
      st.uid !== uid ||
      (st.mode & 0o077) !== 0 ||
      realpathSync(file) !== path.resolve(file)
    )
      throw Error('Private regular operator-owned file required');
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function fileHash(file) {
  const fd = openSync(file, 'r'),
    buffer = Buffer.alloc(1024 * 1024),
    h = createHash('sha256');
  try {
    let n;
    while ((n = readSync(fd, buffer, 0, buffer.length, null)) > 0)
      h.update(buffer.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return h.digest('hex');
}
function durable(file, data) {
  const temp = `${file}.tmp`;
  writeFileSync(temp, JSON.stringify(data) + '\n', { mode: 0o600 });
  const fd = openSync(temp, 'r');
  fsyncSync(fd);
  closeSync(fd);
  renameSync(temp, file);
  const dir = openSync(path.dirname(file), 'r');
  fsyncSync(dir);
  closeSync(dir);
}
// Injection is for command-order/failure tests; CLI never accepts alternate roots/tools.
export function deploy(
  m,
  phase,
  {
    root = '/opt/digital-autograph',
    state = '/var/lib/digital-autograph/manual',
    run = execute,
    ownerUid = 0,
    read = (file) => privateFile(file, ownerUid),
    save = durable,
    wait = (ms) =>
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  } = {},
) {
  validateManifest(m);
  if (!['prepare', 'apply', 'start'].includes(phase))
    throw Error('Unknown manual phase');
  const incoming = path.join(root, 'incoming', m.operation),
    op = path.join(state, m.operation);
  const recordFile = path.join(op, 'state.json'),
    envFile = path.join(op, 'compose.env');
  const json = (file) => JSON.parse(read(file).toString());
  let authorityProofSha256;
  if (phase !== 'prepare') {
    const metadata = read(path.join(incoming, 'metadata-proof.json'));
    validateMetadataProof(
      JSON.parse(metadata),
      m.instanceId,
      m.runtimeServiceAccountId,
      m.runtimeSecretIds,
    );
    authorityProofSha256 = sha256(metadata);
  }
  const toolFiles = [
    'manual-deploy.mjs',
    'manual-env.mjs',
    'deploy-on-vm.sh',
    'Caddyfile',
    'Caddyfile.destka',
    'postgres-bootstrap.sql',
    'postgres-runtime.sql',
    'database-state.sql',
    'compose.yaml',
    'compose.staging.yaml',
    'compose.manual.yaml',
  ];
  if (
    fingerprint(
      Object.fromEntries(
        toolFiles.map((f) => {
          const file = path.join(root, f),
            st = statSync(file);
          if (
            !st.isFile() ||
            st.uid !== ownerUid ||
            st.mode & 0o022 ||
            realpathSync(file) !== file
          )
            throw Error('Untrusted installed tool');
          return [f, sha256(readFileSync(file))];
        }),
      ),
    ) !== m.toolBundleSha256
  )
    throw Error('Installed tool bundle changed');
  const env = {
    APP_ENV: 'staging',
    YC_REGISTRY_ID: 'manual-offline',
    IMAGE_TAG: m.sourceSha,
    WEB_DOMAIN: m.domains.web,
    API_DOMAIN: m.domains.api,
    RUNTIME_ENV_DIR: path.join(incoming, 'env'),
    CADDY_CONFIG: path.join(root, m.caddyConfig),
    POSTGRES_IMAGE: m.infrastructure.postgres,
    CADDY_IMAGE: m.infrastructure.caddy,
    ...Object.fromEntries(
      targets.map((app) => [`${app.toUpperCase()}_IMAGE`, m.images[app].id]),
    ),
  };
  const context = [
    'compose',
    '--project-name',
    m.project,
    '--profile',
    'migration',
    '--env-file',
    envFile,
    '-f',
    path.join(root, 'compose.yaml'),
    '-f',
    path.join(root, 'compose.staging.yaml'),
    '-f',
    path.join(root, 'compose.manual.yaml'),
  ];
  const compose = (args, options) =>
    run('docker', [...context, ...args], options);
  const db = (sql) =>
    compose(
      [
        'exec',
        '-T',
        'postgres',
        'sh',
        '-c',
        'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
      ],
      { input: sql },
    );
  let record;
  const mark = (stage) => {
    record = {
      ...record,
      ...(stage === 'STOPPED' ? { failedFrom: record?.stage } : {}),
      stage,
      updatedAt: new Date().toISOString(),
    };
    save(recordFile, record);
  };
  const stopWriters = () => {
    const ids = compose(['ps', '-aq', 'api', 'worker'])
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (ids.length) run('docker', ['update', '--restart=no', ...ids]);
    compose(['stop', '--timeout', '60', 'api', 'worker']);
  };
  if (phase === 'prepare') {
    if (existsSync(recordFile))
      throw Error(
        'Operation already exists; inspect receipt, never blindly resume',
      );
    // Capacity check is read-only and precedes any app/DB mutation. No image pruning.
    for (const location of [root, state]) {
      const bytes = run('df', ['-B1', '--output=avail', '--', location])
        .trim()
        .split(/\s+/)
        .at(-1);
      if (!/^\d+$/.test(bytes) || BigInt(bytes) < 7n * 1024n ** 3n)
        throw Error(
          'At least 7 GiB free required; never delete evidence to proceed',
        );
      const inodes = run('df', ['--output=iavail', '--', location])
        .trim()
        .split(/\s+/)
        .at(-1);
      if (!/^\d+$/.test(inodes) || BigInt(inodes) < 200000n)
        throw Error('Insufficient inodes');
    }
    mkdirSync(op, { recursive: true, mode: 0o700 });
    writeFileSync(
      envFile,
      Object.entries(env)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n') + '\n',
      { mode: 0o600 },
    );
    for (const app of ['api', 'worker', 'migration'])
      read(path.join(incoming, 'env', `${app}.env`));
    const model = JSON.parse(compose(['config', '--format', 'json']));
    validateRuntime(model, m);
    if (
      db(
        "SELECT count(*) FROM pg_hba_file_rules WHERE type LIKE 'host%' AND auth_method='trust' AND coalesce(address,'') NOT IN ('127.0.0.1','::1');",
      ).trim() !== '0'
    )
      throw Error(
        'Non-loopback trust authentication defeats runtime role isolation',
      );
    const sizeText = db('SELECT pg_database_size(current_database());').trim();
    if (!/^\d+$/.test(sizeText)) throw Error('Unknown database size');
    const archiveBytes = targets.reduce(
      (sum, app) =>
        sum + BigInt(statSync(path.join(incoming, m.images[app].archive)).size),
      0n,
    );
    const required = 2n * archiveBytes + BigInt(sizeText) + 1024n ** 3n;
    for (const location of [root, state]) {
      const available = run('df', ['-B1', '--output=avail', '--', location])
        .trim()
        .split(/\s+/)
        .at(-1);
      if (!/^\d+$/.test(available) || BigInt(available) < required)
        throw Error('Insufficient archive/backup working space');
    }
    for (const app of targets) {
      const archivePath = path.join(incoming, m.images[app].archive);
      const archiveStat = statSync(archivePath);
      if (
        archiveStat.uid !== ownerUid ||
        archiveStat.mode & 0o077 ||
        realpathSync(archivePath) !== archivePath
      )
        throw Error('Private archive required');
      if (fileHash(archivePath) !== m.images[app].archiveSha256)
        throw Error('Archive checksum mismatch');
      run(
        'docker',
        ['load', '--input', path.join(incoming, m.images[app].archive)],
        { timeout: 600000 },
      );
      const image = JSON.parse(
        run('docker', ['image', 'inspect', m.images[app].id]),
      )[0];
      if (
        image.Os !== 'linux' ||
        image.Id !== m.images[app].id ||
        image.Architecture !== 'amd64' ||
        image.Config.Labels?.['org.opencontainers.image.revision'] !==
          m.sourceSha
      )
        throw Error('Image source/platform mismatch');
    }
    for (const app of ['postgres', 'caddy']) {
      const id = compose(['ps', '-q', app]).trim();
      if (
        !id ||
        run('docker', ['inspect', '--format', '{{.Image}}', id]).trim() !==
          m.infrastructure[app]
      )
        throw Error('Existing infrastructure mismatch');
    }
    record = {
      manifestHash: fingerprint(m),
      configHash: fingerprint(model),
      stage: 'PREFLIGHT',
      sourceSha: m.sourceSha,
      sourceHostname: hostname(),
    };
    mark('FREEZING');
    try {
      stopWriters();
      wait(m.drainSeconds * 1000);
      if (
        db(
          "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend';",
        ).trim() !== '0'
      )
        throw Error('Other writers/sessions remain');
      const baseline = JSON.parse(
        db(readFileSync(path.join(root, 'database-state.sql'), 'utf8')),
      );
      if (
        !Array.isArray(baseline.migrations) ||
        baseline.migrations.length > m.migrations.length ||
        fingerprint(baseline.migrations) !==
          fingerprint(m.migrations.slice(0, baseline.migrations.length))
      )
        throw Error('Unknown baseline migration hashes');
      const dumpPath = path.join(op, 'database.dump');
      compose(
        [
          'exec',
          '-T',
          'postgres',
          'sh',
          '-c',
          'exec pg_dump --format=custom --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"',
        ],
        { timeout: 600000, stdoutFile: dumpPath },
      );
      record = {
        ...record,
        baseline,
        baselineHash: fingerprint(baseline),
        databaseArchiveSha256: fileHash(dumpPath),
      };
      mark('BACKUP_REQUIRED');
    } catch {
      mark('STOPPED');
      throw Error(
        'Prepare failed; writers remain stopped; inspect private receipt',
      );
    }
    return record;
  }
  record = json(recordFile);
  if (record.manifestHash !== fingerprint(m))
    throw Error('Manifest changed; new approval required');
  const proof = json(path.join(op, 'recovery-proof.json'));
  if (
    proof.databaseArchiveSha256 !== record.databaseArchiveSha256 ||
    proof.baselineHash !== record.baselineHash ||
    !hash.test(proof.filesManifestSha256) ||
    proof.offVm !== true ||
    proof.databaseRestorePassed !== true ||
    proof.filesRestorePassed !== true ||
    !proof.reviewedBy
  )
    throw Error('Off-VM database AND file recovery proof required');
  const model = JSON.parse(compose(['config', '--format', 'json']));
  const passwords = validateRuntime(model, m);
  const filesManifest = read(path.join(op, 'files-manifest.json'));
  if (
    sha256(filesManifest) !== proof.filesManifestSha256 ||
    proof.sourceBucket !== model.services.api.environment.S3_BUCKET ||
    proof.sourceEndpoint !==
      new URL(model.services.api.environment.S3_ENDPOINT).origin
  )
    throw Error('Backup source/manifest mismatch');
  if (fingerprint(model) !== record.configHash)
    throw Error('Runtime configuration changed');
  if (phase === 'apply') {
    if (record.stage !== 'BACKUP_REQUIRED')
      throw Error(
        'Unknown/partial migration state; inspect, never replay automatically',
      );
    if (
      fingerprint(
        JSON.parse(
          db(readFileSync(path.join(root, 'database-state.sql'), 'utf8')),
        ),
      ) !== record.baselineHash
    )
      throw Error('Database changed after backup');
    if (
      fileHash(path.join(op, 'database.dump')) !== record.databaseArchiveSha256
    )
      throw Error('Backup changed');
    record = { ...record, authorityProofSha256 };
    mark('MIGRATING');
    try {
      const settings = ['api', 'worker', 'migrator']
        .map(
          (role, i) => `SET destka.${role}_scram = '${scram(passwords[i])}';`,
        )
        .join('\n');
      db(
        settings +
          '\n' +
          readFileSync(path.join(root, 'postgres-bootstrap.sql'), 'utf8'),
      );
      compose(['run', '--rm', '-T', '--no-deps', 'migration'], {
        timeout: 600000,
      });
      db(readFileSync(path.join(root, 'postgres-runtime.sql'), 'utf8'));
      const after = JSON.parse(
        db(readFileSync(path.join(root, 'database-state.sql'), 'utf8')),
      );
      if (fingerprint(after.migrations) !== fingerprint(m.migrations))
        throw Error('Migration receipts mismatch');
      record = { ...record, schemaHash: fingerprint(after.migrations) };
      mark('MIGRATED');
    } catch {
      mark('STOPPED');
      throw Error(
        'Migration outcome requires inspection; no old-image or database rollback',
      );
    }
    return record;
  }
  if (record.stage !== 'MIGRATED')
    throw Error('Verified migration receipt required');
  if (
    fingerprint(
      JSON.parse(
        db(readFileSync(path.join(root, 'database-state.sql'), 'utf8')),
      ).migrations,
    ) !== record.schemaHash
  )
    throw Error('Schema changed');
  mark('STARTING');
  try {
    compose(
      [
        'up',
        '-d',
        '--wait',
        '--wait-timeout',
        '120',
        '--no-deps',
        '--force-recreate',
        '--pull',
        'never',
        'api',
        'worker',
        'web',
      ],
      { timeout: 180000 },
    );
    for (const app of ['api', 'worker', 'web']) {
      const id = compose(['ps', '-q', app]).trim();
      if (
        !id ||
        run('docker', [
          'inspect',
          '--format',
          '{{.Image}} {{.State.Status}}',
          id,
        ]).trim() !== `${m.images[app].id} running`
      )
        throw Error('Runtime image mismatch');
    }
    for (const app of ['api', 'worker']) {
      const identity = compose([
        'exec',
        '-T',
        app,
        'node',
        '--input-type=module',
        '-e',
        `import pg from 'pg';const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();const r=await c.query('SELECT current_user AS name,rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls AS unsafe FROM pg_roles WHERE rolname=current_user');console.log(JSON.stringify(r.rows[0]));await c.end();`,
      ]);
      const result = JSON.parse(identity);
      if (result.name !== `da_${app}` || result.unsafe !== false)
        throw Error('Unsafe runtime role');
    }
    compose(
      ['up', '-d', '--no-deps', '--force-recreate', '--pull', 'never', 'caddy'],
      {
        timeout: 120000,
      },
    );
    for (const [host, route] of [
      [m.domains.api, '/health/ready'],
      [m.domains.web, '/'],
    ])
      run('curl', [
        '--fail',
        '--silent',
        '--output',
        '/dev/null',
        '--max-time',
        '15',
        `https://${host}${route}`,
      ]);
    mark('HEALTHY');
    return record;
  } catch {
    stopWriters();
    mark('STOPPED');
    throw Error(
      'Startup failed; writers stopped; only reviewed compatible forward recovery',
    );
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    if (process.getuid?.() !== 0 || process.argv.length !== 4)
      throw Error('Root manual phase and manifest required');
    const m = JSON.parse(privateFile(process.argv[3]));
    const lock = '/var/lib/digital-autograph/manual/operator.lock';
    mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
    // flock survives child calls, is released on SSH/process death; receipt blocks replay.
    if (process.env.DESTKA_MANUAL_LOCKED !== '1') {
      const r = spawnSync(
        'flock',
        [
          '--nonblock',
          lock,
          process.execPath,
          process.argv[1],
          ...process.argv.slice(2),
        ],
        {
          stdio: 'inherit',
          env: { ...process.env, DESTKA_MANUAL_LOCKED: '1' },
        },
      );
      process.exit(r.status ?? 1);
    }
    const result = deploy(m, process.argv[2]);
    console.log(
      JSON.stringify({ operation: m.operation, stage: result.stage }),
    );
  } catch {
    console.error(
      'Manual deployment refused/stopped. Inspect private operation receipt. No automatic rollback.',
    );
    process.exitCode = 1;
  }
}
