import { randomUUID, createHash } from 'node:crypto';
import { afterAll, beforeEach, it, expect } from 'vitest';
import {
  createDatabase,
  createPgNotificationRepository,
  createPgShareRepository,
  createPgSessionRepository,
} from '../../packages/db/src/index';
import { SessionService } from '../../packages/auth/src/index';
import {
  NotificationService,
  notificationCycle,
} from '../../packages/notifications/src/index';
import { buildApi } from '../../apps/api/src/app';
import { renderShareCard } from '../../apps/api/src/notifications/share-card';
import sharp from 'sharp';

const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/autograph_test')
  throw new Error('Isolated autograph_test required');
const database = createDatabase(url);
const second = createDatabase(url);
const repository = createPgNotificationRepository(database.pool);
const otherRepository = createPgNotificationRepository(second.pool);
const shares = createPgShareRepository(database.pool);
const sessions = new SessionService(
  createPgSessionRepository(database.pool),
  1209600,
);
const app = buildApi(
  database,
  sessions,
  {
    appEnvironment: 'test',
    sessionTtlSeconds: 1209600,
    trustedWebOrigins: ['http://127.0.0.1:3000'],
  },
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  {
    service: new NotificationService(repository),
    shares,
    telegram: { username: 'synthetic_bot', secret: 'a'.repeat(32) },
  },
);
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
async function fixture() {
  const userId = randomUUID(),
    otherId = randomUUID(),
    creatorId = randomUUID(),
    wallId = randomUUID(),
    slotId = randomUUID(),
    autographId = randomUUID();
  await database.pool.query('INSERT INTO users (id) VALUES ($1),($2)', [
    userId,
    otherId,
  ]);
  await database.pool.query(
    'INSERT INTO creators (id,owner_user_id) VALUES ($1,$2)',
    [creatorId, userId],
  );
  await database.pool.query(
    "INSERT INTO creator_profiles (creator_id,slug,display_name) VALUES ($1,'test-creator','Creator <safe>')",
    [creatorId],
  );
  await database.pool.query(
    "INSERT INTO walls (id,creator_id,status,slot_count) VALUES ($1,$2,'live',1)",
    [wallId, creatorId],
  );
  await database.pool.query(
    'INSERT INTO slots (id,wall_id,position) VALUES ($1,$2,0)',
    [slotId, wallId],
  );
  await database.pool.query(
    "INSERT INTO autographs (id,user_id,source,status) VALUES ($1,$2,'canvas','ready')",
    [autographId, userId],
  );
  return { userId, otherId, creatorId, wallId, slotId, autographId };
}
async function placement(f: Awaited<ReturnType<typeof fixture>>) {
  return (
    await database.pool.query<{ id: string }>(
      "INSERT INTO placements (slot_id,user_id,autograph_id,source) VALUES ($1,$2,$3,'free_claim') RETURNING id",
      [f.slotId, f.userId, f.autographId],
    )
  ).rows[0]!.id;
}
async function event(
  f: Awaited<ReturnType<typeof fixture>>,
  kind = 'user_displaced',
) {
  await database.pool.query(
    'INSERT INTO notification_events (source_key,user_id,kind,wall_id,slot_id) VALUES ($1,$2,$3,$4,$5)',
    [randomUUID(), f.userId, kind, f.wallId, f.slotId],
  );
}
beforeEach(() => database.pool.query('TRUNCATE users CASCADE'));
afterAll(async () => {
  await app.close();
  await database.close();
  await second.close();
});
it('captures authoritative placement facts, rollback leaves no event, concurrent fanout deduplicates', async () => {
  const f = await fixture();
  const client = await database.pool.connect();
  await client.query('BEGIN');
  await client.query(
    "INSERT INTO placements (slot_id,user_id,source) VALUES ($1,$2,'admin')",
    [f.slotId, f.userId],
  );
  await client.query('ROLLBACK');
  client.release();
  expect(
    (await database.pool.query('SELECT * FROM notification_events')).rowCount,
  ).toBe(0);
  const id = await placement(f);
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      (i % 2 ? repository : otherRepository).collect(),
    ),
  );
  expect(
    await new NotificationService(repository).inbox(f.userId),
  ).toMatchObject([
    { kind: 'slot_claimed', deepLink: `/walls/${f.wallId}#slot-${f.slotId}` },
  ]);
  await database.pool.query(
    "UPDATE placements SET ended_at=clock_timestamp(),end_reason='takeover' WHERE id=$1",
    [id],
  );
  await repository.collect();
  expect((await repository.inbox(f.userId)).map((n) => n.kind)).toContain(
    'user_displaced',
  );
  expect(
    (await database.pool.query('SELECT * FROM notification_deliveries'))
      .rowCount,
  ).toBe(4);
});
it('caps takeover-war events across pools and honors preferences', async () => {
  const f = await fixture();
  for (let i = 0; i < 12; i++) await event(f);
  await Promise.all([repository.collect(), otherRepository.collect()]);
  expect(await repository.inbox(f.userId)).toHaveLength(1);
  await repository.updatePreferences(f.userId, {
    web: false,
    telegram: false,
    mutedKinds: [],
  });
  await event(f, 'slot_claimed');
  await repository.collect();
  expect(await repository.inbox(f.userId)).toHaveLength(1);
  expect(
    (
      await database.pool.query(
        "SELECT count(*)::int n FROM notification_deliveries WHERE state='suppressed'",
      )
    ).rows[0].n,
  ).toBe(25);
});
it('bounds overall fanout to 20 per channel per hour, disabled users receive nothing', async () => {
  const f = await fixture();
  for (let i = 0; i < 23; i++) {
    const wall = randomUUID();
    await database.pool.query(
      "INSERT INTO walls (id,creator_id,status,slot_count) VALUES ($1,$2,'live',0)",
      [wall, f.creatorId],
    );
    await database.pool.query(
      "INSERT INTO notification_events (source_key,user_id,kind,wall_id) VALUES ($1,$2,'user_displaced',$3)",
      [randomUUID(), f.userId, wall],
    );
  }
  await repository.collect();
  await repository.collect();
  expect(await repository.inbox(f.userId)).toHaveLength(20);
  await database.pool.query("UPDATE users SET status='disabled' WHERE id=$1", [
    f.userId,
  ]);
  await event(f, 'slot_claimed');
  await repository.collect();
  expect(await repository.inbox(f.userId)).toHaveLength(20);
});
it.each(['payment_status', 'refund_status'])(
  'financial %s facts retain the hourly cap and channel preferences',
  async (kind) => {
    const f = await fixture();
    await repository.issueLink(f.userId, hash('synthetic-financial'));
    await repository.acceptLink(hash('synthetic-financial'), '123');
    // Synthetic future refund facts exercise fanout only; no refund is executed.
    for (let i = 0; i < 23; i++) await event(f, kind);
    await Promise.all([repository.collect(), otherRepository.collect()]);
    await repository.collect();
    expect(await repository.inbox(f.userId)).toHaveLength(20);
    const deliveries = await database.pool.query(
      `SELECT channel,state,count(*)::int n FROM notification_deliveries GROUP BY channel,state ORDER BY channel,state`,
    );
    expect(deliveries.rows).toEqual([
      { channel: 'telegram', state: 'queued', n: 20 },
      { channel: 'telegram', state: 'suppressed', n: 3 },
      { channel: 'web', state: 'sent', n: 20 },
      { channel: 'web', state: 'suppressed', n: 3 },
    ]);
    // Age out the rate budget so suppression below proves the preferences gate.
    await database.pool.query(
      "UPDATE notification_deliveries SET created_at=clock_timestamp()-interval '2 hours'",
    );
    await repository.updatePreferences(f.userId, {
      web: true,
      telegram: true,
      mutedKinds: [kind as 'payment_status' | 'refund_status'],
    });
    const mutedEvent = await database.pool.query<{ id: string }>(
      'INSERT INTO notification_events (source_key,user_id,kind,wall_id,slot_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [randomUUID(), f.userId, kind, f.wallId, f.slotId],
    );
    await repository.collect();
    expect(await repository.inbox(f.userId)).toHaveLength(20);
    expect(
      (
        await database.pool.query(
          'SELECT channel,state FROM notification_deliveries WHERE event_id=$1 ORDER BY channel',
          [mutedEvent.rows[0]!.id],
        )
      ).rows,
    ).toEqual([
      { channel: 'telegram', state: 'suppressed' },
      { channel: 'web', state: 'suppressed' },
    ]);
  },
);
it('one-time channel binding, consent check, concurrent sender and /stop suppress retries', async () => {
  const f = await fixture();
  await repository.issueLink(f.userId, hash('synthetic'));
  await repository.acceptLink(hash('synthetic'), '123');
  await expect(repository.acceptLink(hash('synthetic'), '456')).rejects.toThrow(
    'NOT_FOUND',
  );
  await event(f);
  await repository.collect();
  const results = await Promise.all([
    repository.claimDelivery(),
    otherRepository.claimDelivery(),
  ]);
  const job = results.find(Boolean)!;
  expect(results.filter(Boolean)).toHaveLength(1);
  await repository.finishDelivery(job, {
    state: 'retry',
    retryAfterSeconds: 1,
  });
  await repository.stopChat('123');
  await database.pool.query(
    "UPDATE notification_deliveries SET available_at=clock_timestamp()-interval '2 seconds',attempt_at=NULL WHERE state='retry'",
  );
  expect(await repository.claimDelivery()).toBeNull();
  expect(
    (
      await database.pool.query(
        'SELECT state FROM notification_deliveries WHERE id=$1',
        [job.id],
      )
    ).rows[0].state,
  ).toBe('suppressed');
});
it('crashed or ambiguous sends are never automatically resent; stale tokens cannot settle', async () => {
  const f = await fixture();
  await repository.issueLink(f.userId, hash('synthetic'));
  await repository.acceptLink(hash('synthetic'), '123');
  await event(f);
  await repository.collect();
  const job = (await repository.claimDelivery())!;
  await database.pool.query(
    "UPDATE notification_deliveries SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    [job.id],
  );
  expect(await repository.claimDelivery()).toBeNull();
  await repository.finishDelivery(job, { state: 'sent' });
  expect(
    (
      await database.pool.query(
        'SELECT state FROM notification_deliveries WHERE id=$1',
        [job.id],
      )
    ).rows[0].state,
  ).toBe('uncertain');
});
it('unlinked Telegram cannot be enabled and old events do not enter a newly connected channel', async () => {
  const f = await fixture();
  await expect(
    repository.updatePreferences(f.userId, {
      web: true,
      telegram: true,
      mutedKinds: [],
    }),
  ).rejects.toThrow('CHANNEL_NOT_LINKED');
  await event(f);
  await repository.issueLink(f.userId, hash('synthetic'));
  await repository.acceptLink(hash('synthetic'), '123');
  await repository.collect();
  expect(await repository.claimDelivery()).toBeNull();
});
it('wall subscription is scoped to public walls, due reminders deduplicate and unsubscribe works', async () => {
  const f = await fixture();
  await database.pool.query(
    "UPDATE walls SET status='scheduled',start_at=clock_timestamp()+interval '5 minutes' WHERE id=$1",
    [f.wallId],
  );
  await repository.follow(f.userId, f.wallId, true);
  await Promise.all([repository.collect(), otherRepository.collect()]);
  expect((await repository.inbox(f.userId)).map((n) => n.kind)).toEqual([
    'drop_starting',
  ]);
  await repository.follow(f.userId, f.wallId, false);
  expect(
    (await database.pool.query('SELECT * FROM notification_subscriptions'))
      .rowCount,
  ).toBe(0);
});
it('rechecks drop schedule and subscription immediately before an external delivery', async () => {
  const f = await fixture();
  await repository.issueLink(f.userId, hash('synthetic'));
  await repository.acceptLink(hash('synthetic'), '123');
  await database.pool.query(
    "UPDATE walls SET status='scheduled',start_at=clock_timestamp()+interval '5 minutes' WHERE id=$1",
    [f.wallId],
  );
  await repository.follow(f.userId, f.wallId, true);
  await repository.collect();
  await database.pool.query(
    "UPDATE walls SET start_at=clock_timestamp()+interval '1 day' WHERE id=$1",
    [f.wallId],
  );
  expect(await repository.claimDelivery()).toBeNull();
  expect(
    (
      await database.pool.query(
        "SELECT state FROM notification_deliveries WHERE channel='telegram'",
      )
    ).rows[0].state,
  ).toBe('suppressed');
  await database.pool.query(
    "UPDATE walls SET start_at=clock_timestamp()+interval '5 minutes' WHERE id=$1",
    [f.wallId],
  );
  await repository.collect();
  await repository.follow(f.userId, f.wallId, false);
  expect(await repository.claimDelivery()).toBeNull();
  expect(
    (
      await database.pool.query(
        "SELECT count(*)::int n FROM notification_deliveries WHERE channel='telegram' AND state='queued'",
      )
    ).rows[0].n,
  ).toBe(0);
});
it('cooldown reminder follows the pinned pricing version and is suppressed after displacement', async () => {
  const f = await fixture();
  const pc = await database.pool.query<{ id: string }>(
    `INSERT INTO pricing_config_versions (algorithm_version,currency,base_amount_minor,minimum_amount_minor,maximum_amount_minor,
      dynamic_takeover_limit,takeover_step_size,step_amount_minor,decay_interval_seconds,decay_amount_minor,decay_floor_amount_minor,
      guaranteed_visibility_seconds,created_by_user_id)
      VALUES ('takeover_ladder_v1','RUB',100,100,1000,3,1,100,60,0,100,120,$1) RETURNING id`,
    [f.userId],
  );
  await database.pool.query(
    "UPDATE walls SET pricing_config_id=$2,status='paused' WHERE id=$1",
    [f.wallId, pc.rows[0]!.id],
  );
  const p = (
    await database.pool.query<{ id: string }>(
      "INSERT INTO placements (slot_id,user_id,autograph_id,source,started_at) VALUES ($1,$2,$3,'free_claim',clock_timestamp()-interval '125 seconds') RETURNING id",
      [f.slotId, f.userId, f.autographId],
    )
  ).rows[0]!.id;
  await repository.issueLink(f.userId, hash('synthetic'));
  await repository.acceptLink(hash('synthetic'), '123');
  await repository.collect();
  expect(
    (await repository.inbox(f.userId)).some((n) => n.kind === 'cooldown_ended'),
  ).toBe(false);
  await database.pool.query("UPDATE walls SET status='live' WHERE id=$1", [
    f.wallId,
  ]);
  await Promise.all([repository.collect(), otherRepository.collect()]);
  expect(
    (await repository.inbox(f.userId)).filter(
      (n) => n.kind === 'cooldown_ended',
    ),
  ).toHaveLength(1);
  await database.pool.query(
    "UPDATE placements SET ended_at=clock_timestamp(),end_reason='takeover' WHERE id=$1",
    [p],
  );
  expect(await repository.claimDelivery()).toBeNull();
  expect(
    (
      await database.pool.query(
        "SELECT state FROM notification_deliveries d JOIN notification_events e ON e.id=d.event_id WHERE e.kind='cooldown_ended' AND d.channel='telegram'",
      )
    ).rows[0].state,
  ).toBe('suppressed');
});
it('explicit rejected retries stop at five attempts across worker restarts', async () => {
  const f = await fixture();
  await repository.issueLink(f.userId, hash('synthetic'));
  await repository.acceptLink(hash('synthetic'), '123');
  await event(f);
  await repository.collect();
  for (let i = 0; i < 5; i++) {
    const job = (await (i % 2 ? repository : otherRepository).claimDelivery())!;
    expect(job).not.toBeNull();
    await repository.finishDelivery(job, {
      state: 'retry',
      retryAfterSeconds: 1,
    });
    await database.pool.query(
      "UPDATE notification_deliveries SET available_at=clock_timestamp()-interval '2 seconds',attempt_at=NULL WHERE id=$1",
      [job.id],
    );
  }
  expect(await repository.claimDelivery()).toBeNull();
  expect(
    (
      await database.pool.query(
        "SELECT state,attempts FROM notification_deliveries WHERE channel='telegram'",
      )
    ).rows[0],
  ).toEqual({ state: 'failed', attempts: 5 });
});
it('owner-only inbox/read/preferences and origin guard; bot webhook secret and private chat checked', async () => {
  const f = await fixture();
  await event(f);
  await repository.collect();
  const token = (await sessions.createSession(f.otherId)).token;
  expect((await app.inject('/me/notifications')).statusCode).toBe(401);
  expect(
    (
      await app.inject({
        url: '/me/notifications',
        headers: { cookie: `da_session=${token}` },
      })
    ).json(),
  ).toEqual([]);
  const id = (await repository.inbox(f.userId))[0]!.id;
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/me/notifications/${id}/read`,
        headers: {
          cookie: `da_session=${token}`,
          origin: 'http://127.0.0.1:3000',
        },
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/me/notifications/preferences',
        headers: { cookie: `da_session=${token}` },
        payload: { web: false, telegram: false, mutedKinds: [] },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/notifications/telegram/webhook',
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
  await repository.issueLink(f.userId, hash('a'.repeat(43)));
  const update = {
    message: {
      text: `/start ${'a'.repeat(43)}`,
      from: { id: 123, is_bot: false },
      chat: { id: 123, type: 'group' },
    },
  };
  await app.inject({
    method: 'POST',
    url: '/notifications/telegram/webhook',
    headers: { 'x-telegram-bot-api-secret-token': 'a'.repeat(32) },
    payload: update,
  });
  expect((await repository.preferences(f.userId)).telegramLinked).toBe(false);
  update.message.chat.type = 'private';
  await app.inject({
    method: 'POST',
    url: '/notifications/telegram/webhook',
    headers: { 'x-telegram-bot-api-secret-token': 'a'.repeat(32) },
    payload: update,
  });
  expect((await repository.preferences(f.userId)).telegramLinked).toBe(true);
});
it('shares require own placement, reveal only explicit alias; archival/revocation stops public output', async () => {
  const f = await fixture();
  await placement(f);
  await expect(
    shares.create(f.otherId, { wallId: f.wallId, slotId: f.slotId }),
  ).rejects.toThrow('NOT_FOUND');
  const card = await shares.create(f.userId, {
    wallId: f.wallId,
    slotId: f.slotId,
    publicAlias: 'Public Fan',
  });
  expect(Object.keys(card).sort()).toEqual(
    [
      'creator',
      'event',
      'id',
      'publicAlias',
      'slotId',
      'slotNumber',
      'wallId',
    ].sort(),
  );
  expect(card.publicAlias).toBe('Public Fan');
  expect(JSON.stringify(card)).not.toContain(f.userId);
  const png = await renderShareCard(card);
  expect(await sharp(png).metadata()).toMatchObject({
    format: 'png',
    width: 1200,
    height: 630,
  });
  const key = randomUUID();
  await Promise.all([
    shares.interact(card.id, 'share_clicked', key),
    shares.interact(card.id, 'share_clicked', key),
  ]);
  expect(
    (await database.pool.query('SELECT * FROM share_interactions')).rowCount,
  ).toBe(1);
  await shares.revoke(f.userId, card.id);
  expect(await shares.public(card.id)).toBeNull();
  const next = await shares.create(f.userId, {
    wallId: f.wallId,
    slotId: f.slotId,
  });
  expect(next.publicAlias).toBeNull();
  await database.pool.query("UPDATE walls SET status='archived' WHERE id=$1", [
    f.wallId,
  ]);
  expect(await shares.public(next.id)).toBeNull();
});
it('final-wall sharing requires ended Wall and owner or participant, no arbitrary username', async () => {
  const f = await fixture();
  await expect(shares.create(f.userId, { wallId: f.wallId })).rejects.toThrow();
  await database.pool.query("UPDATE walls SET status='ended' WHERE id=$1", [
    f.wallId,
  ]);
  await expect(shares.create(f.otherId, { wallId: f.wallId })).rejects.toThrow(
    'NOT_FOUND',
  );
  expect(
    await shares.create(f.userId, { wallId: f.wallId, publicAlias: 'omitted' }),
  ).toMatchObject({ event: 'final_wall', publicAlias: null, slotNumber: null });
});
it('worker sends fixed deep link without private data, finishes one successful attempt', async () => {
  const f = await fixture();
  await repository.issueLink(f.userId, hash('synthetic'));
  await repository.acceptLink(hash('synthetic'), '123');
  await event(f);
  let calls = 0;
  await notificationCycle(
    repository,
    {
      send: async (chat, text) => {
        calls++;
        expect(chat).toBe('123');
        expect(text).toContain(`/walls/${f.wallId}#slot-${f.slotId}`);
        expect(text).not.toContain(f.userId);
        return { state: 'sent' };
      },
    },
    'https://example.test',
  );
  await notificationCycle(
    repository,
    {
      send: async () => {
        calls++;
        return { state: 'sent' };
      },
    },
    'https://example.test',
  );
  expect(calls).toBe(1);
});
