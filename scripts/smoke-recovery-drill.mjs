import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import console from 'node:console';
import process from 'node:process';

// Synthetic, disposable containers only. No source/restore URL or volume input.
const root = fileURLToPath(new URL('../', import.meta.url));
const name = `da-recovery-${randomUUID()}`;
const source = `${name}-src`;
const target = `${name}-dst`;
const created = [];
const id = (n) => `'00000000-0000-4000-8000-${String(n).padStart(12, '0')}'`;
const started = performance.now();
let phase = 'network';
let sqlState = null;

function invoke(args, input) {
  return spawnSync('docker', args, {
    cwd: root,
    input,
    timeout: 120000,
    maxBuffer: 64 * 1024 * 1024,
  });
}
function docker(args, input) {
  const result = invoke(args, input);
  if (result.error || result.status !== 0) {
    sqlState =
      result.stderr?.toString().match(/ERROR:\s+([0-9A-Z]{5})\b/)?.[1] ?? null;
    throw new Error('Isolated recovery command failed');
  }
  return result.stdout;
}
function sql(container, query) {
  return docker(
    [
      'exec',
      '-i',
      container,
      'psql',
      '-XqAt',
      '-U',
      'recovery_test',
      '-d',
      'recovery_test',
      '-v',
      'ON_ERROR_STOP=1',
      '-v',
      'VERBOSITY=sqlstate',
    ],
    query,
  )
    .toString()
    .trim();
}
function rejected(query, code) {
  const result = invoke(
    [
      'exec',
      '-i',
      target,
      'psql',
      '-XqAt',
      '-U',
      'recovery_test',
      '-d',
      'recovery_test',
      '-v',
      'ON_ERROR_STOP=1',
      '-v',
      'VERBOSITY=sqlstate',
    ],
    query,
  );
  assert.equal(result.status, 3, 'Expected SQL invariant rejection');
  assert.match(
    result.stderr.toString(),
    new RegExp(`\\b${code}\\b`),
    'Expected SQLSTATE',
  );
}

try {
  docker(['network', 'create', '--internal', name]);
  created.push(name);
  for (const container of [source, target]) {
    phase = container === source ? 'source_start' : 'target_start';
    // Record only after successful creation; never remove a pre-existing name.
    docker([
      'create',
      '--name',
      container,
      '--network',
      name,
      '--tmpfs',
      '/var/lib/postgresql/data:rw,noexec,nosuid,size=256m',
      '-e',
      'POSTGRES_USER=recovery_test',
      '-e',
      'POSTGRES_PASSWORD=synthetic_local_only',
      '-e',
      'POSTGRES_DB=recovery_test',
      'postgres:17-alpine',
    ]);
    created.push(container);
    docker(['start', container]);
    let ready = false;
    for (let attempt = 0; attempt < 45; attempt++) {
      if (
        invoke([
          'exec',
          container,
          'pg_isready',
          '-U',
          'recovery_test',
          '-d',
          'recovery_test',
        ]).status === 0
      ) {
        ready = true;
        break;
      }
      await delay(1000);
    }
    assert.ok(ready, 'Isolated PostgreSQL readiness failed');
    assert.equal(
      sql(
        container,
        "SELECT count(*) FROM pg_tables WHERE schemaname='public'",
      ),
      '0',
    );
  }
  phase = 'migrations';
  const journal = JSON.parse(
    readFileSync(
      new URL('../packages/db/drizzle/meta/_journal.json', import.meta.url),
    ),
  );
  for (const entry of journal.entries) {
    assert.match(entry.tag, /^\d{4}_[a-z0-9_]+$/);
    sql(
      source,
      readFileSync(
        new URL(`../packages/db/drizzle/${entry.tag}.sql`, import.meta.url),
      ),
    );
  }
  // Real schema and triggers, synthetic fixture. No providers or workers run.
  phase = 'financial_fixture';
  // Detect the applied schema; never disable guards or publish legal documents.
  const hasLegalSnapshot =
    sql(
      source,
      "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_orders' AND column_name='offer_hash')",
    ) === 't';
  const hasCheckoutConfirmation =
    sql(
      source,
      "SELECT to_regclass('public.checkout_confirmations') IS NOT NULL",
    ) === 't';
  assert.ok(!hasCheckoutConfirmation || hasLegalSnapshot);
  const legalColumns = hasLegalSnapshot
    ? ',offer_version,offer_hash,content_rules_version,content_rules_hash,refund_policy_version,refund_policy_hash'
    : '';
  const legalValues = hasLegalSnapshot
    ? ", 'synthetic-v1',repeat('c',64),'synthetic-v1',repeat('d',64),'synthetic-v1',repeat('e',64)"
    : '';
  const checkoutEvidence = hasCheckoutConfirmation
    ? `INSERT INTO checkout_confirmations
      (order_id,user_id,reservation_id,autograph_id,amount_minor,currency,guaranteed_visibility_seconds,reservation_expires_at,target_placement_id,pricing_config_id,offer_version,offer_hash,content_rules_version,content_rules_hash,refund_policy_version,refund_policy_hash)
      SELECT o.id,o.user_id,o.reservation_id,o.autograph_id,o.amount_minor,o.currency,p.guaranteed_visibility_seconds,r.expires_at,o.target_placement_id,o.pricing_config_id,o.offer_version,o.offer_hash,o.content_rules_version,o.content_rules_hash,o.refund_policy_version,o.refund_policy_hash
      FROM payment_orders o JOIN takeover_reservations r ON r.id=o.reservation_id
      JOIN pricing_config_versions p ON p.id=o.pricing_config_id WHERE o.id=${id(12)};`
    : '';
  sql(
    source,
    `BEGIN;
    INSERT INTO users (id) VALUES (${id(1)}),(${id(2)}),(${id(3)});
    INSERT INTO creators (id,owner_user_id) VALUES (${id(4)},${id(1)});
    INSERT INTO pricing_config_versions (id,algorithm_version,currency,base_amount_minor,minimum_amount_minor,maximum_amount_minor,dynamic_takeover_limit,takeover_step_size,step_amount_minor,decay_interval_seconds,decay_amount_minor,decay_floor_amount_minor,guaranteed_visibility_seconds,created_by_user_id)
      VALUES (${id(5)},'takeover_ladder_v1','RUB',65000,10000,100000,3,1,1000,60,100,10000,0,${id(1)});
    INSERT INTO walls (id,creator_id,pricing_config_id,status,slot_count) VALUES (${id(6)},${id(4)},${id(5)},'live',1);
    INSERT INTO slots (id,wall_id,position) VALUES (${id(7)},${id(6)},0);
    INSERT INTO autographs (id,user_id,source,status) VALUES (${id(8)},${id(2)},'canvas','ready');
    INSERT INTO placements (id,slot_id,user_id,source,started_at,ended_at,end_reason)
      VALUES (${id(9)},${id(7)},${id(3)},'free_claim',now()-interval '10 minutes',now()-interval '1 minute','takeover');
    INSERT INTO takeover_quotes (id,user_id,wall_id,slot_id,target_placement_id,pricing_config_id,algorithm_version,currency,amount_minor,wall_takeover_count,step_index,ladder_amount_minor,decay_intervals_applied,quoted_at,expires_at)
      VALUES (${id(10)},${id(2)},${id(6)},${id(7)},${id(9)},${id(5)},'takeover_ladder_v1','RUB',65000,0,0,65000,0,now(),now()+interval '5 minutes');
    INSERT INTO takeover_reservations (id,quote_id,user_id,wall_id,slot_id,target_placement_id,pricing_config_id,currency,amount_minor,idempotency_key_hash,status,created_at,expires_at)
      VALUES (${id(11)},${id(10)},${id(2)},${id(6)},${id(7)},${id(9)},${id(5)},'RUB',65000,repeat('a',64),'active',now(),now()+interval '5 minutes');
    INSERT INTO payment_orders (id,user_id,reservation_id,quote_id,wall_id,slot_id,target_placement_id,autograph_id,creator_id,pricing_config_id,amount_minor,currency,creator_share_bps${legalColumns})
      VALUES (${id(12)},${id(2)},${id(11)},${id(10)},${id(6)},${id(7)},${id(9)},${id(8)},${id(4)},${id(5)},65000,'RUB',5000${legalValues});
    ${checkoutEvidence}
    INSERT INTO payments (id,order_id,provider,shop_id,mode,operation_key,request_fingerprint,return_url,amount_minor,currency)
      VALUES (${id(13)},${id(12)},'yookassa','synthetic','sandbox',${id(14)},repeat('b',64),'https://example.test/return',65000,'RUB');
    INSERT INTO placements (id,slot_id,user_id,autograph_id,source) VALUES (${id(15)},${id(7)},${id(2)},${id(8)},'takeover');
    UPDATE takeover_reservations SET status='consumed',consumed_at=now() WHERE id=${id(11)};
    UPDATE payment_orders SET status='fulfilled',placement_id=${id(15)},fulfilled_at=now() WHERE id=${id(12)};
    UPDATE payments SET status='fulfilled',provider_payment_id='synthetic-provider-payment',raw_status='succeeded',verified_at=now() WHERE id=${id(13)};
    INSERT INTO creator_earnings (id,order_id,payment_id,placement_id,creator_id,gross_amount_minor,amount_minor,share_bps,currency)
      VALUES (${id(16)},${id(12)},${id(13)},${id(15)},${id(4)},65000,32500,5000,'RUB');
    COMMIT;`,
  );
  const tables = [
    'users',
    'creators',
    'pricing_config_versions',
    'walls',
    'slots',
    'autographs',
    'placements',
    'takeover_quotes',
    'takeover_reservations',
    'payment_orders',
    'payments',
    'creator_earnings',
    'notification_events',
    ...(hasLegalSnapshot ? ['legal_evidence_events'] : []),
    ...(hasCheckoutConfirmation ? ['checkout_confirmations'] : []),
  ];
  const fingerprint = (container) =>
    createHash('sha256')
      .update(
        tables
          .map((table) =>
            sql(
              container,
              `SELECT coalesce(json_agg(t ORDER BY id),'[]') FROM ${table} t`,
            ),
          )
          .join('\n'),
      )
      .digest('hex');
  const before = fingerprint(source);
  phase = 'dump';
  const dumpStarted = performance.now();
  const archive = docker([
    'exec',
    source,
    'pg_dump',
    '-U',
    'recovery_test',
    '-d',
    'recovery_test',
    '--format=custom',
    '--no-owner',
    '--no-privileges',
  ]);
  assert.ok(
    archive.length > 100 && archive.subarray(0, 5).toString() === 'PGDMP',
    'Expected custom PostgreSQL archive',
  );
  const dumpMilliseconds = Math.round(performance.now() - dumpStarted);
  const restoreStarted = performance.now();
  phase = 'restore';
  docker(
    [
      'exec',
      '-i',
      target,
      'pg_restore',
      '-U',
      'recovery_test',
      '-d',
      'recovery_test',
      '--single-transaction',
      '--exit-on-error',
      '--no-owner',
      '--no-privileges',
    ],
    archive,
  );
  phase = 'verify';
  assert.equal(
    fingerprint(target),
    before,
    'Restored financial/history snapshot differs',
  );
  assert.equal(fingerprint(source), before, 'Source was modified');
  assert.equal(
    sql(
      target,
      `SELECT count(*) FROM payment_orders o JOIN payments p ON p.order_id=o.id
    JOIN placements l ON l.id=o.placement_id JOIN creator_earnings e ON e.order_id=o.id AND e.payment_id=p.id AND e.placement_id=l.id
    WHERE o.status='fulfilled' AND p.status='fulfilled' AND o.amount_minor=65000 AND p.amount_minor=65000 AND e.amount_minor=32500`,
    ),
    '1',
  );
  rejected('UPDATE creator_earnings SET amount_minor=0', '23514');
  rejected(
    `INSERT INTO placements (slot_id,user_id,source) VALUES (${id(7)},${id(3)},'free_claim')`,
    '23505',
  );
  rejected(
    `INSERT INTO slots (wall_id,position) VALUES (${id(99)},1)`,
    '23503',
  );
  rejected(
    `UPDATE payment_orders SET amount_minor=1 WHERE id=${id(12)}`,
    '23514',
  );
  if (hasLegalSnapshot)
    rejected(
      `UPDATE payment_orders SET offer_hash=repeat('f',64) WHERE id=${id(12)}`,
      '23514',
    );
  if (hasCheckoutConfirmation)
    rejected(
      `UPDATE checkout_confirmations SET amount_minor=1 WHERE order_id=${id(12)}`,
      '23514',
    );
  assert.equal(
    fingerprint(target),
    before,
    'Rejected mutations changed restored evidence',
  );
  console.log(
    JSON.stringify({
      event: 'SYNTHETIC_RECOVERY_DRILL_PASS',
      archiveBytes: archive.length,
      dumpMilliseconds,
      restoreAndVerifyMilliseconds: Math.round(
        performance.now() - restoreStarted,
      ),
      totalMilliseconds: Math.round(performance.now() - started),
      financialChains: 1,
      sourceUnchanged: true,
      restoredConstraintsChecked: true,
      legalSnapshotChecked: hasLegalSnapshot,
      checkoutConfirmationChecked: hasCheckoutConfirmation,
      productionRestore: false,
    }),
  );
} catch {
  console.error(
    JSON.stringify({
      event: 'SYNTHETIC_RECOVERY_DRILL_FAILED',
      phase,
      sqlState,
    }),
  );
  process.exitCode = 1;
} finally {
  let cleanupFailed = false;
  for (const container of [target, source]) {
    if (
      created.includes(container) &&
      invoke(['rm', '-fv', container]).status !== 0
    )
      cleanupFailed = true;
  }
  if (created.includes(name) && invoke(['network', 'rm', name]).status !== 0)
    cleanupFailed = true;
  if (cleanupFailed) {
    console.error('{"event":"SYNTHETIC_RECOVERY_CLEANUP_FAILED"}');
    process.exitCode = 1;
  }
}
