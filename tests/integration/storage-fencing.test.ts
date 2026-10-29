import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import sharp from 'sharp';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  AutographService,
  processingArtifactKey,
} from '../../packages/autographs/src/index';
import {
  createDatabase,
  createPgAutographRepository,
  createPgAutographProcessingRepository,
} from '../../packages/db/src/index';
import { StorageCommitUnknownError } from '../../packages/db/src/storage-lease';
import { createPrivateS3Storage } from '../../packages/integrations/src/private-s3';
import { processOneAutographJob } from '../../apps/worker/src/worker';

const url = process.env.TEST_DATABASE_URL!;
if (
  !url ||
  new URL(url).pathname !== '/autograph_test' ||
  !['localhost', '127.0.0.1'].includes(new URL(url).hostname)
)
  throw new Error('Use isolated loopback autograph_test');
const endpoint = process.env.S3_ENDPOINT!;
if (
  !endpoint ||
  !['localhost', '127.0.0.1'].includes(new URL(endpoint).hostname)
)
  throw new Error('Use isolated loopback MinIO');
const db = createDatabase(url);
const storage = createPrivateS3Storage({
  endpoint,
  region: 'us-east-1',
  bucket: process.env.S3_BUCKET!,
  accessKeyId: process.env.S3_ACCESS_KEY_ID!,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
});
const repo = createPgAutographRepository(db.pool);
const service = new AutographService(repo, storage, 300);
const jobs = createPgAutographProcessingRepository(db.pool);
const keys = new Set<string>();
type Pool = typeof db.pool;

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Faults wrap the real PostgreSQL client; the COMMIT really executes (or its
// connection really closes before COMMIT). No in-memory transaction substitute.
function commitFault(commitNumber: number, afterCommit: boolean): Pool {
  let commits = 0;
  return {
    query: db.pool.query.bind(db.pool),
    connect: async () => {
      const client = await db.pool.connect();
      return {
        query: async (sql: string, values?: unknown[]) => {
          const fault = sql === 'COMMIT' && ++commits === commitNumber;
          if (fault && !afterCommit)
            throw new Error('Synthetic COMMIT transport failure');
          const result = await client.query(sql, values);
          if (fault) throw new Error('Synthetic COMMIT acknowledgement lost');
          return result;
        },
        release: client.release.bind(client),
      };
    },
  } as unknown as Pool;
}

async function fixture(bytes = Buffer.from('test')) {
  const user = randomUUID();
  await db.pool.query('INSERT INTO users(id) VALUES ($1::uuid)', [user]);
  const draft = await service.create(user, 'canvas');
  const upload = await service.initiateUpload(user, draft.id, {
    contentType: 'image/png',
    sizeBytes: bytes.length,
  });
  const key = `autographs/${draft.id}/original/${upload.assetId}`;
  keys.add(key);
  const write = (active = service, value = bytes) =>
    active.uploadOriginal(
      user,
      draft.id,
      upload.assetId,
      'image/png',
      async () => value,
      new AbortController().signal,
    );
  return { user, draft, upload, key, bytes, write };
}

async function expire(f: Awaited<ReturnType<typeof fixture>>) {
  await db.pool.query(
    "UPDATE autograph_assets SET created_at = now() - interval '2 hours', upload_expires_at = now() - interval '1 hour' WHERE id = $1::uuid",
    [f.upload.assetId],
  );
}
async function expireLeases() {
  await db.pool.query(
    "UPDATE autograph_storage_leases SET expires_at = clock_timestamp() - interval '1 second'",
  );
}
async function fresh(f: Awaited<ReturnType<typeof fixture>>) {
  const upload = await service.initiateUpload(f.user, f.draft.id, {
    contentType: 'image/png',
    sizeBytes: 4,
  });
  const key = `autographs/${f.draft.id}/original/${upload.assetId}`;
  keys.add(key);
  await service.uploadOriginal(
    f.user,
    f.draft.id,
    upload.assetId,
    'image/png',
    async () => Buffer.from('new!'),
    new AbortController().signal,
  );
  return { upload, key };
}

beforeAll(async () => {
  await db.checkConnection();
  await storage.bootstrapLocalBucket();
});
beforeEach(async () => {
  await db.pool.query(
    'TRUNCATE users, original_upload_tombstones, autograph_storage_leases CASCADE',
  );
});
afterEach(async () => {
  const artifacts = await db.pool.query<{ storage_key: string }>(
    'SELECT storage_key FROM autograph_processing_artifacts',
  );
  for (const row of artifacts.rows) keys.add(row.storage_key);
  await db.pool.query('TRUNCATE autograph_storage_leases');
});
afterAll(async () => {
  await Promise.all([...keys].map((key) => storage.deleteObject(key)));
  storage.close();
  await db.close();
});

describe('durable private storage fencing with real PostgreSQL and MinIO', () => {
  it.each(['claim', 'put'])(
    'recovers after SIGKILL following %s without losing the original generation',
    async (phase) => {
      const f = await fixture();
      const child = spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          '--input-type=module',
          '-e',
          `
      import { createDatabase, createPgAutographRepository } from './packages/db/src/index.ts';
      import { createPrivateS3Storage } from './packages/integrations/src/private-s3.ts';
      const db = createDatabase(process.env.TEST_DATABASE_URL);
      const storage = createPrivateS3Storage({endpoint:process.env.S3_ENDPOINT,region:'us-east-1',bucket:process.env.S3_BUCKET,accessKeyId:process.env.S3_ACCESS_KEY_ID,secretAccessKey:process.env.S3_SECRET_ACCESS_KEY});
      await createPgAutographRepository(db.pool).uploadOriginal(process.env.A03_TEST_USER,process.env.A03_TEST_AUTOGRAPH,process.env.A03_TEST_ASSET,async asset => {
        if (process.env.A03_TEST_PHASE === 'put') await storage.putOriginal({key:asset.storageKey,contentType:'image/png',bytes:Buffer.from('test'),signal:new AbortController().signal});
        process.stdout.write('DURABLE_STORAGE_CHECKPOINT\\n');
        await new Promise(() => {});
      });
    `,
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            A03_TEST_USER: f.user,
            A03_TEST_AUTOGRAPH: f.draft.id,
            A03_TEST_ASSET: f.upload.assetId,
            A03_TEST_PHASE: phase,
          },
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      );
      const exited = once(child, 'exit');
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Child storage checkpoint not reached')),
            5000,
          );
          child.once('exit', () => {
            clearTimeout(timer);
            reject(new Error('Child exited before checkpoint'));
          });
          child.stdout.setEncoding('utf8');
          let output = '';
          child.stdout.on('data', (part: string) => {
            output += part;
            if (output.includes('DURABLE_STORAGE_CHECKPOINT')) {
              clearTimeout(timer);
              resolve();
            }
          });
        });
        child.kill('SIGKILL');
        await exited;
        expect(
          (await db.pool.query('SELECT count(*) FROM autograph_storage_leases'))
            .rows[0].count,
        ).toBe('1');
        expect(db.pool.idleCount).toBe(db.pool.totalCount);
        await expireLeases();
        if (phase === 'claim') await f.write();
        await service.completeUpload(f.user, f.draft.id);
        expect(await storage.getPrivateObject(f.key, 4)).toEqual(f.bytes);
        expect(
          (
            await db.pool.query(
              'SELECT count(*) FROM autograph_processing_jobs',
            )
          ).rows[0].count,
        ).toBe('1');
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
          await exited;
        }
      }
    },
  );
  it('releases its only connection and row lock during byte and HEAD I/O', async () => {
    const f = await fixture();
    const single = createDatabase(url);
    single.pool.options.max = 1;
    const active = new AutographService(
      createPgAutographRepository(single.pool),
      storage,
      300,
    );
    const entered = gate(),
      resume = gate();
    const pending = active.uploadOriginal(
      f.user,
      f.draft.id,
      f.upload.assetId,
      'image/png',
      async () => {
        entered.resolve();
        await resume.promise;
        return f.bytes;
      },
      new AbortController().signal,
    );
    try {
      await entered.promise;
      const client = await single.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'SELECT id FROM autographs WHERE id = $1::uuid FOR UPDATE NOWAIT',
          [f.draft.id],
        );
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
      expect(single.pool.idleCount).toBe(1);
    } finally {
      resume.resolve();
      await pending;
      await single.close();
    }
    const headEntered = gate(),
      headResume = gate();
    const complete = repo.completeOriginal(f.user, f.draft.id, async () => {
      headEntered.resolve();
      await headResume.promise;
      return (await storage.statObject(f.key))!.sizeBytes;
    });
    await headEntered.promise;
    try {
      expect(db.pool.idleCount).toBe(db.pool.totalCount);
      await expire(f);
      expect(
        await jobs.cleanupAbandoned(60, (key) => storage.deleteObject(key)),
      ).toBe(false);
      expect((await db.pool.query('SELECT 1')).rowCount).toBe(1);
    } finally {
      headResume.resolve();
      await complete;
    }
    expect(await storage.getPrivateObject(f.key, 4)).toEqual(f.bytes);
  });

  it('fences a stale PUT and reaps its late write without touching a fresh generation', async () => {
    const f = await fixture();
    const entered = gate(),
      resume = gate();
    const pending = service.uploadOriginal(
      f.user,
      f.draft.id,
      f.upload.assetId,
      'image/png',
      async () => {
        entered.resolve();
        await resume.promise;
        return f.bytes;
      },
      new AbortController().signal,
    );
    const rejected = expect(pending).rejects.toMatchObject({
      code: 'UPLOAD_BUSY',
    });
    await entered.promise;
    await expire(f);
    await expireLeases();
    expect(
      await jobs.cleanupAbandoned(60, (key) => storage.deleteObject(key)),
    ).toBe(true);
    const next = await fresh(f);
    resume.resolve();
    await rejected;
    expect(await storage.getPrivateObject(f.key, 4)).toEqual(f.bytes);
    await db.pool.query(
      'UPDATE original_upload_tombstones SET next_check_at = now()',
    );
    expect(
      await jobs.cleanupAbandoned(60, (key) => storage.deleteObject(key)),
    ).toBe(true);
    expect(await storage.statObject(f.key)).toBeNull();
    expect(await storage.getPrivateObject(next.key, 4)).toEqual(
      Buffer.from('new!'),
    );
    expect((await service.get(f.user, f.draft.id)).original!.id).toBe(
      next.upload.assetId,
    );
  });

  it('does not let a delayed HEAD finalize a retired or replacement original', async () => {
    const f = await fixture();
    await f.write();
    const entered = gate(),
      resume = gate();
    const pending = repo.completeOriginal(f.user, f.draft.id, async () => {
      const object = await storage.statObject(f.key);
      entered.resolve();
      await resume.promise;
      return object!.sizeBytes;
    });
    const rejected = expect(pending).rejects.toMatchObject({
      code: 'UPLOAD_BUSY',
    });
    await entered.promise;
    await expire(f);
    await expireLeases();
    await jobs.cleanupAbandoned(60, (key) => storage.deleteObject(key));
    const next = await fresh(f);
    await service.completeUpload(f.user, f.draft.id);
    resume.resolve();
    await rejected;
    expect(
      (
        await db.pool.query(
          'SELECT count(*) FROM autograph_processing_jobs WHERE autograph_id = $1',
          [f.draft.id],
        )
      ).rows[0].count,
    ).toBe('1');
    expect(await storage.getPrivateObject(next.key, 4)).toEqual(
      Buffer.from('new!'),
    );
  });

  it('retires before deletion, survives failed cleanup/restart and fences an old cleaner', async () => {
    const f = await fixture();
    await f.write();
    await expire(f);
    const entered = gate(),
      resume = gate();
    const pending = jobs.cleanupAbandoned(60, async (key) => {
      entered.resolve();
      await resume.promise;
      await storage.deleteObject(key);
    });
    const rejected = expect(pending).rejects.toMatchObject({
      code: 'UPLOAD_BUSY',
    });
    await entered.promise;
    expect(db.pool.idleCount).toBe(db.pool.totalCount);
    await expect(
      service.completeUpload(f.user, f.draft.id),
    ).rejects.toMatchObject({ code: 'INVALID_AUTOGRAPH_STATE' });
    await expireLeases();
    const restarted = createPgAutographProcessingRepository(db.pool);
    await expect(
      restarted.cleanupAbandoned(60, async () => {
        throw new Error('Synthetic provider outage');
      }),
    ).rejects.toThrow('Synthetic provider outage');
    expect((await service.get(f.user, f.draft.id)).status).toBe(
      'upload_pending',
    );
    await restarted.cleanupAbandoned(60, (key) => storage.deleteObject(key));
    const next = await fresh(f);
    resume.resolve();
    await rejected;
    expect(await storage.getPrivateObject(next.key, 4)).toEqual(
      Buffer.from('new!'),
    );
    expect(
      (
        await db.pool.query(
          'SELECT count(*) FROM original_upload_tombstones WHERE storage_key = $1',
          [f.key],
        )
      ).rows[0].count,
    ).toBe('1');
  });

  it('does no external work when a claim COMMIT is lost before persistence', async () => {
    const f = await fixture();
    let writes = 0;
    await expect(
      createPgAutographRepository(commitFault(1, false)).uploadOriginal(
        f.user,
        f.draft.id,
        f.upload.assetId,
        async () => {
          writes++;
        },
      ),
    ).rejects.toBeInstanceOf(StorageCommitUnknownError);
    expect(writes).toBe(0);
    expect(
      (await db.pool.query('SELECT count(*) FROM autograph_storage_leases'))
        .rows[0].count,
    ).toBe('0');
    await f.write();
    expect(await storage.getPrivateObject(f.key, 4)).toEqual(f.bytes);
  });

  it.each([1, 2])(
    'resolves lost upload COMMIT acknowledgement %i by its durable receipt',
    async (commit) => {
      const f = await fixture();
      const uncertain = new AutographService(
        createPgAutographRepository(commitFault(commit, true)),
        storage,
        300,
      );
      await f.write(uncertain);
      expect(await storage.getPrivateObject(f.key, 4)).toEqual(f.bytes);
      expect(
        (await db.pool.query('SELECT count(*) FROM autograph_storage_leases'))
          .rows[0].count,
      ).toBe('0');
    },
  );

  it('resolves unknown completion and cleanup finalization without duplicate jobs or lost tombstones', async () => {
    const f = await fixture();
    await f.write();
    const uncertain = new AutographService(
      createPgAutographRepository(commitFault(2, true)),
      storage,
      300,
    );
    await uncertain.completeUpload(f.user, f.draft.id);
    await service.completeUpload(f.user, f.draft.id);
    expect(
      (await db.pool.query('SELECT count(*) FROM autograph_processing_jobs'))
        .rows[0].count,
    ).toBe('1');
    const abandoned = await fixture();
    await abandoned.write();
    await expire(abandoned);
    await createPgAutographProcessingRepository(
      commitFault(2, true),
    ).cleanupAbandoned(60, (key) => storage.deleteObject(key));
    expect((await service.get(abandoned.user, abandoned.draft.id)).status).toBe(
      'draft',
    );
    expect(
      (
        await db.pool.query(
          'SELECT count(*) FROM original_upload_tombstones WHERE storage_key = $1',
          [abandoned.key],
        )
      ).rows[0].count,
    ).toBe('1');
  });

  it('keeps recoverable evidence when final COMMIT never persists after successful storage I/O', async () => {
    const f = await fixture();
    await f.write();
    const uncertain = new AutographService(
      createPgAutographRepository(commitFault(2, false)),
      storage,
      300,
    );
    await expect(
      uncertain.completeUpload(f.user, f.draft.id),
    ).rejects.toBeInstanceOf(StorageCommitUnknownError);
    expect((await service.get(f.user, f.draft.id)).status).toBe(
      'upload_pending',
    );
    expect(await storage.getPrivateObject(f.key, 4)).toEqual(f.bytes);
    expect(
      (await db.pool.query('SELECT count(*) FROM autograph_processing_jobs'))
        .rows[0].count,
    ).toBe('0');
    await service.completeUpload(f.user, f.draft.id);
    expect(
      (await db.pool.query('SELECT count(*) FROM autograph_processing_jobs'))
        .rows[0].count,
    ).toBe('1');

    const abandoned = await fixture();
    await abandoned.write();
    await expire(abandoned);
    await expect(
      createPgAutographProcessingRepository(
        commitFault(2, false),
      ).cleanupAbandoned(60, (key) => storage.deleteObject(key)),
    ).rejects.toBeInstanceOf(StorageCommitUnknownError);
    expect((await service.get(abandoned.user, abandoned.draft.id)).status).toBe(
      'upload_pending',
    );
    expect(await storage.statObject(abandoned.key)).toBeNull();
    // The retired reserved row still tracks the deleted key after a restart.
    await createPgAutographProcessingRepository(db.pool).cleanupAbandoned(
      60,
      (key) => storage.deleteObject(key),
    );
    expect((await service.get(abandoned.user, abandoned.draft.id)).status).toBe(
      'draft',
    );
    expect(
      (
        await db.pool.query(
          'SELECT count(*) FROM original_upload_tombstones WHERE storage_key = $1',
          [abandoned.key],
        )
      ).rows[0].count,
    ).toBe('1');
  });

  it('isolates stale processing PUT/delete from the adopted output and reconciles late orphan writes', async () => {
    const image = await sharp(
      Buffer.from(
        '<svg width="1200" height="600"><rect width="1200" height="600" fill="white"/><path d="M200 300 Q400 150 600 320 T1000 250" fill="none" stroke="black" stroke-width="8"/></svg>',
      ),
    )
      .png()
      .toBuffer();
    const f = await fixture(image);
    await f.write();
    await service.completeUpload(f.user, f.draft.id);
    const stale = (await jobs.claim(300))!;
    const oldKey = processingArtifactKey(stale);
    keys.add(oldKey);
    await storage.putPrivateObject(oldKey, Buffer.from('old!'));
    const entered = gate(),
      resume = gate();
    const cleaning = jobs.cleanupPartial(stale, 300, async () => {
      entered.resolve();
      await resume.promise;
      await storage.deleteObject(oldKey);
    });
    await entered.promise;
    expect(db.pool.idleCount).toBe(db.pool.totalCount);
    await db.pool.query(
      "UPDATE autograph_processing_jobs SET claimed_at = now() - interval '1 hour' WHERE id = $1",
      [stale.id],
    );
    await processOneAutographJob({
      repository: jobs,
      storage,
      leaseSeconds: 300,
      pollIntervalMs: 1,
      cleanupGraceSeconds: 60,
    });
    const adopted = (
      await db.pool.query<{ storage_key: string }>(
        "SELECT storage_key FROM autograph_assets WHERE autograph_id = $1 AND role = 'cleaned'",
        [f.draft.id],
      )
    ).rows[0]!.storage_key;
    keys.add(adopted);
    const bytes = await storage.getPrivateObject(adopted, 10485760);
    expect(adopted).not.toBe(oldKey);
    resume.resolve();
    expect(await cleaning).toBe(true);
    expect(
      await jobs.succeed(
        stale,
        { key: oldKey, sizeBytes: 4, width: 1, height: 1 },
        300,
      ),
    ).toBe(false);
    expect(
      await jobs.cleanupPartial(stale, 300, async () => {
        throw new Error('Stale cleanup must not run');
      }),
    ).toBe(false);
    await storage.putPrivateObject(oldKey, Buffer.from('late'));
    await db.pool.query(
      "UPDATE autograph_processing_artifacts SET lease_expires_at = now() - interval '1 hour', next_check_at = now() WHERE lease_token = $1",
      [stale.leaseToken],
    );
    expect(
      await jobs.cleanupAbandoned(60, (key) => storage.deleteObject(key)),
    ).toBe(true);
    expect(await storage.statObject(oldKey)).toBeNull();
    expect(await storage.getPrivateObject(adopted, 10485760)).toEqual(bytes);
    await expect(
      storage.putPrivateObject(adopted, Buffer.from('evil')),
    ).rejects.toMatchObject({ $metadata: { httpStatusCode: 412 } });
  });

  it.each([1, 2])(
    'recovers processing COMMIT acknowledgement %i without deleting an adopted artifact',
    async (commit) => {
      const image = await sharp(
        Buffer.from(
          '<svg width="1200" height="600"><rect width="1200" height="600" fill="white"/><path d="M200 300 Q400 150 600 320 T1000 250" fill="none" stroke="black" stroke-width="8"/></svg>',
        ),
      )
        .png()
        .toBuffer();
      const f = await fixture(image);
      await f.write();
      await service.completeUpload(f.user, f.draft.id);
      const uncertain = createPgAutographProcessingRepository(
        commitFault(commit, true),
      );
      await processOneAutographJob({
        repository: uncertain,
        storage,
        leaseSeconds: 300,
        pollIntervalMs: 1,
        cleanupGraceSeconds: 60,
      });
      expect((await service.get(f.user, f.draft.id)).status).toBe(
        'awaiting_approval',
      );
      const artifact = (
        await db.pool.query<{ storage_key: string; adopted: boolean }>(
          'SELECT storage_key, adopted_at IS NOT NULL AS adopted FROM autograph_processing_artifacts',
        )
      ).rows[0]!;
      keys.add(artifact.storage_key);
      expect(artifact.adopted).toBe(true);
      expect(
        (await storage.getPrivateObject(artifact.storage_key, 10485760)).length,
      ).toBeGreaterThan(0);
      expect(
        await jobs.cleanupAbandoned(60, async () => {
          throw new Error('Adopted output must not be deleted');
        }),
      ).toBe(false);
    },
  );
});

describe('finite PostgreSQL runtime budgets', () => {
  it('cancels a contended original row without beginning storage work', async () => {
    const f = await fixture();
    const blocker = await db.pool.connect();
    let writes = 0;
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        'SELECT id FROM autographs WHERE id = $1::uuid FOR UPDATE',
        [f.draft.id],
      );
      const start = performance.now();
      await expect(
        repo.uploadOriginal(f.user, f.draft.id, f.upload.assetId, async () => {
          writes++;
        }),
      ).rejects.toMatchObject({ code: 'UPLOAD_BUSY' });
      expect(performance.now() - start).toBeLessThan(6500);
      expect(writes).toBe(0);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
    }
    await f.write();
    expect(await storage.getPrivateObject(f.key, 4)).toEqual(f.bytes);
  });
  it('enforces startup deadlines even if the DSN asks for infinite timeouts', async () => {
    const value = new URL(url);
    value.searchParams.set('statement_timeout', '0');
    value.searchParams.set('query_timeout', '0');
    value.searchParams.set(
      'options',
      '-c statement_timeout=0 -c lock_timeout=0',
    );
    const bounded = createDatabase(value.href);
    try {
      const settings = await bounded.pool.query(
        "SELECT current_setting('statement_timeout') AS statement, current_setting('lock_timeout') AS lock, current_setting('idle_in_transaction_session_timeout') AS idle",
      );
      expect(settings.rows[0]).toEqual({
        statement: '10s',
        lock: '5s',
        idle: '15s',
      });
      const start = performance.now();
      await expect(
        bounded.pool.query('SELECT pg_sleep(20)'),
      ).rejects.toMatchObject({ code: '57014' });
      expect(performance.now() - start).toBeLessThan(11500);
      expect((await bounded.pool.query('SELECT 1')).rowCount).toBe(1);
    } finally {
      await bounded.close();
    }
  });
  it('bounds exhausted pool acquisition and recovers after releasing the connection', async () => {
    const single = createDatabase(url);
    single.pool.options.max = 1;
    const held = await single.pool.connect();
    try {
      const start = performance.now();
      await expect(single.pool.connect()).rejects.toThrow();
      expect(performance.now() - start).toBeLessThan(4500);
    } finally {
      held.release();
    }
    expect((await single.pool.query('SELECT 1')).rowCount).toBe(1);
    await single.close();
  });
});
