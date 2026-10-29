import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  createDatabase,
  createPgPricingRepository,
  createPgTakeoverReservationRepository,
} from '../../packages/db/src/index';
import {
  TakeoverQuoteService,
  TakeoverReservationService,
} from '../../packages/walls/src/index';
const value = process.env.TEST_DATABASE_URL;
if (!value || new URL(value).pathname !== '/autograph_test')
  throw new Error('Migration requires isolated autograph_test');
const admin = createDatabase(value);
afterAll(() => admin.close());
const folder = join(process.cwd(), 'packages/db/drizzle');
const dbFolder = join(process.cwd(), 'packages/db');
const journal = JSON.parse(
  readFileSync(join(folder, 'meta/_journal.json'), 'utf8'),
);
async function migrate(name: string, directory: string) {
  const u = new URL(value!);
  u.pathname = `/${name}`;
  const full = () =>
    spawnSync(
      process.execPath,
      [
        realpathSync(join(dbFolder, 'node_modules/drizzle-kit/bin.cjs')),
        'migrate',
      ],
      {
        cwd: dbFolder,
        env: { ...process.env, APP_ENV: 'test', DATABASE_URL: u.href },
        encoding: 'utf8',
        timeout: 30000,
      },
    );
  // Use a temporary config to point drizzle at the pre-migration journal without altering old files.
  if (directory !== folder) {
    const config = join(directory, 'drizzle.config.cjs');
    writeFileSync(
      config,
      `module.exports={dialect:'postgresql',out:${JSON.stringify(directory)},dbCredentials:{url:process.env.DATABASE_URL}};`,
    );
    const before = spawnSync(
      process.execPath,
      [
        realpathSync(join(dbFolder, 'node_modules/drizzle-kit/bin.cjs')),
        'migrate',
        '--config',
        config,
      ],
      {
        cwd: dbFolder,
        env: { ...process.env, APP_ENV: 'test', DATABASE_URL: u.href },
        encoding: 'utf8',
        timeout: 30000,
      },
    );
    expect(before.error).toBeUndefined();
    expect(before.status, before.stdout + before.stderr).toBe(0);
  } else {
    const result = full();
    expect(result.error).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
  }
}
it.each([17, 19])(
  'migrates clean DB twice and upgrades populated pre-00%s without fabricated checkout confirmation',
  async (beforeIndex) => {
    const name = `autograph_test_legal_${randomUUID().replaceAll('-', '')}`;
    const u = new URL(value!);
    u.pathname = `/${name}`;
    const temp = mkdtempSync(join(tmpdir(), 'da-legal-upgrade-'));
    await admin.pool.query(`CREATE DATABASE "${name}"`);
    const db = createDatabase(u.href);
    try {
      mkdirSync(join(temp, 'meta'));
      const before = {
        ...journal,
        entries: journal.entries.filter(
          (e: { idx: number }) => e.idx < beforeIndex,
        ),
      };
      writeFileSync(join(temp, 'meta/_journal.json'), JSON.stringify(before));
      for (const e of before.entries)
        copyFileSync(join(folder, `${e.tag}.sql`), join(temp, `${e.tag}.sql`));
      await migrate(name, temp);
      const user = randomUUID(),
        occupant = randomUUID(),
        creator = randomUUID(),
        wall = randomUUID(),
        slot = randomUUID(),
        autograph = randomUUID();
      await db.pool.query('INSERT INTO users(id) VALUES($1),($2)', [
        user,
        occupant,
      ]);
      await db.pool.query(
        "INSERT INTO sessions(user_id,secret_hash,expires_at) VALUES($1,'synthetic-migration-session',now()+interval '1 day')",
        [user],
      );
      await db.pool.query(
        "INSERT INTO social_identities(user_id,provider,provider_user_id) VALUES($1,'google','synthetic-migration-sub')",
        [user],
      );
      await db.pool.query(
        "INSERT INTO consent_records(user_id,document_type,document_version,source) VALUES($1,'terms','legacy','web')",
        [user],
      );
      await db.pool.query('INSERT INTO creators(id) VALUES($1)', [creator]);
      const config = await db.pool.query(
        `INSERT INTO pricing_config_versions(algorithm_version,currency,base_amount_minor,minimum_amount_minor,maximum_amount_minor,dynamic_takeover_limit,takeover_step_size,step_amount_minor,decay_interval_seconds,decay_amount_minor,decay_floor_amount_minor,guaranteed_visibility_seconds,created_by_user_id) VALUES('takeover_ladder_v1','RUB',65000,10000,100000,3,1,1000,60,100,10000,0,$1) RETURNING id`,
        [user],
      );
      await db.pool.query(
        "INSERT INTO walls(id,creator_id,status,slot_count,pricing_config_id) VALUES($1,$2,'live',1,$3)",
        [wall, creator, config.rows[0].id],
      );
      await db.pool.query(
        'INSERT INTO slots(id,wall_id,position) VALUES($1,$2,0)',
        [slot, wall],
      );
      await db.pool.query(
        "INSERT INTO autographs(id,user_id,source,status) VALUES($1,$2,'canvas','draft')",
        [autograph, user],
      );
      await db.pool.query(
        "INSERT INTO placements(slot_id,user_id,source,started_at) VALUES($1,$2,'free_claim',now()-interval '1 hour')",
        [slot, occupant],
      );
      const q = await new TakeoverQuoteService(
        createPgPricingRepository(db.pool),
      ).createQuote({ userId: user, wallId: wall, slotId: slot });
      const r = await new TakeoverReservationService(
        createPgTakeoverReservationRepository(db.pool),
      ).create(user, q.id, randomUUID());
      const seed = await db.pool.connect();
      try {
        await seed.query('BEGIN');
        const order = await seed.query(
          `INSERT INTO payment_orders(user_id,reservation_id,quote_id,wall_id,slot_id,target_placement_id,autograph_id,creator_id,pricing_config_id,amount_minor,currency,creator_share_bps${beforeIndex === 19 ? ',offer_version,offer_hash,content_rules_version,content_rules_hash,refund_policy_version,refund_policy_hash' : ''}) SELECT user_id,id,quote_id,wall_id,slot_id,target_placement_id,$2,$3,pricing_config_id,amount_minor,currency,5000${beforeIndex === 19 ? ",'legacy-v1',repeat('a',64),'legacy-v1',repeat('b',64),'legacy-v1',repeat('c',64)" : ''} FROM takeover_reservations WHERE id=$1 RETURNING id`,
          [r.reservation.id, autograph, creator],
        );
        await seed.query(
          `INSERT INTO payments(order_id,provider,shop_id,mode,operation_key,request_fingerprint,return_url,amount_minor,currency) SELECT id,'yookassa','123','sandbox',$2,repeat('a',64),'https://example.test/return',amount_minor,currency FROM payment_orders WHERE id=$1`,
          [order.rows[0].id, randomUUID()],
        );
        await seed.query('COMMIT');
      } catch (e) {
        await seed.query('ROLLBACK');
        throw e;
      } finally {
        seed.release();
      }
      const tables = [
        'users',
        'sessions',
        'social_identities',
        'consent_records',
        'autographs',
        'placements',
        'payment_orders',
        'payments',
      ];
      const originals = new Map<string, string>();
      for (const t of tables)
        originals.set(
          t,
          JSON.stringify(
            (
              await db.pool.query(
                `SELECT to_jsonb(t) AS record FROM ${t} t ORDER BY id`,
              )
            ).rows,
          ),
        );
      await migrate(name, folder);
      for (const t of tables) {
        const subtraction =
          t === 'payment_orders' && beforeIndex === 17
            ? " - ARRAY['offer_version','offer_hash','content_rules_version','content_rules_hash','refund_policy_version','refund_policy_hash']"
            : '';
        expect(
          JSON.stringify(
            (
              await db.pool.query(
                `SELECT to_jsonb(t)${subtraction} AS record FROM ${t} t ORDER BY id`,
              )
            ).rows,
          ),
        ).toBe(originals.get(t));
      }
      expect(
        (
          await db.pool.query(
            'SELECT offer_hash,offer_version FROM payment_orders',
          )
        ).rows[0],
      ).toEqual(
        beforeIndex === 17
          ? { offer_hash: null, offer_version: null }
          : { offer_hash: 'a'.repeat(64), offer_version: 'legacy-v1' },
      );
      expect(
        (await db.pool.query('SELECT 1 FROM checkout_confirmations')).rowCount,
      ).toBe(0);
      expect(
        (await db.pool.query('SELECT * FROM legal_evidence_events')).rowCount,
      ).toBe(0);
      await migrate(name, folder);
      expect(
        (
          await db.pool.query(
            'SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations',
          )
        ).rows[0].count,
      ).toBe(journal.entries.length);
    } finally {
      await db.close();
      await admin.pool.query(`DROP DATABASE "${name}"`);
      rmSync(temp, { recursive: true, force: true });
    }
  },
  60000,
);
it('upgrades populated pre-0018 preserving exact append-only evidence without inferring age', async () => {
  const name = `autograph_test_age_${randomUUID().replaceAll('-', '')}`;
  const u = new URL(value!);
  u.pathname = `/${name}`;
  const temp = mkdtempSync(join(tmpdir(), 'da-age-upgrade-'));
  await admin.pool.query(`CREATE DATABASE "${name}"`);
  const db = createDatabase(u.href);
  try {
    mkdirSync(join(temp, 'meta'));
    const before = {
      ...journal,
      entries: journal.entries.filter((e: { idx: number }) => e.idx < 18),
    };
    writeFileSync(join(temp, 'meta/_journal.json'), JSON.stringify(before));
    for (const e of before.entries)
      copyFileSync(join(folder, `${e.tag}.sql`), join(temp, `${e.tag}.sql`));
    await migrate(name, temp);
    const user = randomUUID();
    await db.pool.query('INSERT INTO users(id) VALUES($1)', [user]);
    await db.pool.query(
      "INSERT INTO legal_evidence_events(user_id,document_type,document_version,document_hash,action,source,context) VALUES($1,'terms_of_use','synthetic-v1',repeat('a',64),'accepted','web','legal_gate')",
      [user],
    );
    const original = (
      await db.pool.query(
        'SELECT to_jsonb(e) AS evidence FROM legal_evidence_events e',
      )
    ).rows;
    await migrate(name, folder);
    expect(
      (
        await db.pool.query(
          'SELECT to_jsonb(e) AS evidence FROM legal_evidence_events e',
        )
      ).rows,
    ).toEqual(original);
    expect(
      (await db.pool.query('SELECT * FROM age_declarations')).rowCount,
    ).toBe(0);
    await migrate(name, folder);
    expect(
      (
        await db.pool.query(
          'SELECT to_jsonb(e) AS evidence FROM legal_evidence_events e',
        )
      ).rows,
    ).toEqual(original);
    expect(
      (
        await db.pool.query(
          'SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations',
        )
      ).rows[0].count,
    ).toBe(journal.entries.length);
  } finally {
    await db.close();
    await admin.pool.query(`DROP DATABASE "${name}"`);
    rmSync(temp, { recursive: true, force: true });
  }
}, 60000);
it('applies all migrations to a clean database and repeats idempotently', async () => {
  const name = `autograph_test_legal_clean_${randomUUID().replaceAll('-', '')}`;
  const u = new URL(value!);
  u.pathname = `/${name}`;
  await admin.pool.query(`CREATE DATABASE "${name}"`);
  const db = createDatabase(u.href);
  try {
    await migrate(name, folder);
    await migrate(name, folder);
    expect(
      (
        await db.pool.query(
          'SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations',
        )
      ).rows[0].count,
    ).toBe(journal.entries.length);
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
        )
      ).rows[0].count,
    ).toBe(35);
    expect(
      (
        await db.pool.query(
          "SELECT column_default, is_nullable FROM information_schema.columns WHERE table_name = 'autograph_assets' AND column_name = 'upload_attempts'",
        )
      ).rows[0],
    ).toEqual({ column_default: '0', is_nullable: 'NO' });
    expect(
      (
        await db.pool.query(
          "SELECT indexname FROM pg_indexes WHERE indexname = 'original_upload_tombstones_next_idx'",
        )
      ).rowCount,
    ).toBe(1);
  } finally {
    await db.close();
    await admin.pool.query(`DROP DATABASE "${name}"`);
  }
}, 60000);
