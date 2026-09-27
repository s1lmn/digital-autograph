import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SessionService } from '../../packages/auth/src/index';
import { buildApi } from '../../apps/api/src/app';
import {
  createDatabase,
  createPgSessionRepository,
  createPgWallRepository,
} from '../../packages/db/src/index';
import { WallService } from '../../packages/walls/src/index';
import { creatorProfiles, creators, users } from '../../packages/db/src/schema';
import { userFixture } from './fixtures';

const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/autograph_test') {
  throw new Error(
    'Wall integration tests require the isolated autograph_test database',
  );
}

const database = createDatabase(url);
const sessions = new SessionService(
  createPgSessionRepository(database.pool),
  1209600,
);
const walls = new WallService(createPgWallRepository(database.pool));
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
  walls,
);

async function fixture() {
  const [owner] = await database.db
    .insert(users)
    .values(userFixture(1))
    .returning();
  const [other] = await database.db
    .insert(users)
    .values(userFixture(2))
    .returning();
  if (!owner || !other) throw new Error('Expected users');
  const [creator] = await database.db
    .insert(creators)
    .values({ ownerUserId: owner.id })
    .returning();
  if (!creator) throw new Error('Expected creator');
  await database.db.insert(creatorProfiles).values({
    creatorId: creator.id,
    slug: 'creator-one',
    displayName: 'Creator One',
  });
  const ownerToken = (await sessions.createSession(owner.id)).token;
  const otherToken = (await sessions.createSession(other.id)).token;
  return { owner, other, creator, ownerToken, otherToken };
}

function headers(token?: string) {
  return token
    ? { cookie: `da_session=${token}`, origin: 'http://127.0.0.1:3000' }
    : {};
}

async function create(
  creatorId: string,
  token: string,
  body: Record<string, unknown> = { slotCount: 3 },
) {
  return app.inject({
    method: 'POST',
    url: `/creators/${creatorId}/walls`,
    headers: headers(token),
    payload: body,
  });
}

async function patch(id: string, token: string, body: Record<string, unknown>) {
  return app.inject({
    method: 'PATCH',
    url: `/walls/${id}`,
    headers: headers(token),
    payload: body,
  });
}

async function action(id: string, token: string, name: string) {
  return app.inject({
    method: 'POST',
    url: `/walls/${id}/transitions`,
    headers: headers(token),
    payload: { action: name },
  });
}

describe('Creator and Wall Domain with PostgreSQL', () => {
  beforeAll(async () => database.checkConnection());
  beforeEach(async () => database.pool.query('TRUNCATE TABLE users CASCADE'));
  afterAll(async () => {
    await app.close();
    await database.close();
  });

  it('authorizes owner mutations and exposes only public creator data', async () => {
    const { creator, ownerToken, otherToken } = await fixture();
    const publicCreator = await app.inject('/creators/creator-one');
    expect(publicCreator.statusCode).toBe(200);
    expect(publicCreator.json()).toEqual({
      id: creator.id,
      slug: 'creator-one',
      displayName: 'Creator One',
      walls: [],
    });
    expect(publicCreator.body).not.toContain('ownerUserId');
    expect((await create(creator.id, otherToken)).statusCode).toBe(403);
    expect((await create(creator.id, '')).statusCode).toBe(401);
    const created = await create(creator.id, ownerToken);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      creatorId: creator.id,
      status: 'draft',
      slotCount: 3,
    });
    const id = created.json().id as string;
    expect((await patch(id, otherToken, { slotCount: 4 })).statusCode).toBe(
      403,
    );
    expect((await action(id, otherToken, 'publish')).statusCode).toBe(403);
    expect((await app.inject(`/walls/${id}`)).statusCode).toBe(404);
    expect((await app.inject('/creators/unknown')).statusCode).toBe(404);
  });

  it('creates contiguous slots, preserves surviving IDs and prevents structural edits with history', async () => {
    const { creator, owner, ownerToken } = await fixture();
    const created = await create(creator.id, ownerToken);
    const id = created.json().id as string;
    const initial = created.json().slots as Array<{
      id: string;
      position: number;
    }>;
    expect(initial.map((slot) => slot.position)).toEqual([0, 1, 2]);
    const grown = await patch(id, ownerToken, { slotCount: 5 });
    expect(grown.statusCode).toBe(200);
    expect(grown.json().slots.slice(0, 3)).toEqual(initial);
    const shrunk = await patch(id, ownerToken, { slotCount: 2 });
    expect(shrunk.statusCode).toBe(200);
    expect(shrunk.json().slots).toEqual(initial.slice(0, 2));
    await database.pool.query(
      "INSERT INTO placements (slot_id, user_id, source) VALUES ($1::uuid, $2::uuid, 'admin')",
      [initial[0]?.id, owner.id],
    );
    expect((await patch(id, ownerToken, { slotCount: 1 })).json()).toEqual({
      error: { code: 'WALL_STRUCTURE_LOCKED' },
    });
    await database.pool.query(
      "UPDATE placements SET ended_at = now(), end_reason = 'test' WHERE slot_id = $1::uuid",
      [initial[0]?.id],
    );
    expect((await patch(id, ownerToken, { slotCount: 1 })).statusCode).toBe(
      409,
    );
    const counts = await database.pool.query<{ count: string }>(
      'SELECT count(*) FROM slots WHERE wall_id = $1::uuid',
      [id],
    );
    expect(counts.rows[0]?.count).toBe('2');
  });

  it('enforces explicit lifecycle and public visibility with active placement occupancy', async () => {
    const { creator, owner, ownerToken } = await fixture();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const created = await create(creator.id, ownerToken, {
      slotCount: 2,
      startAt: future,
    });
    const id = created.json().id as string;
    expect((await action(id, ownerToken, 'publish')).statusCode).toBe(400);
    expect((await action(id, ownerToken, 'schedule')).json().status).toBe(
      'scheduled',
    );
    expect((await app.inject(`/walls/${id}`)).statusCode).toBe(200);
    expect(
      (await app.inject('/creators/creator-one')).json().walls,
    ).toHaveLength(1);
    expect((await patch(id, ownerToken, { slotCount: 3 })).statusCode).toBe(
      409,
    );
    expect((await action(id, ownerToken, 'pause')).statusCode).toBe(409);
    expect((await action(id, ownerToken, 'unschedule')).json().status).toBe(
      'draft',
    );
    expect((await patch(id, ownerToken, { startAt: null })).statusCode).toBe(
      200,
    );
    expect((await action(id, ownerToken, 'publish')).json().status).toBe(
      'live',
    );
    const slotId = created.json().slots[0].id as string;
    await database.pool.query(
      "INSERT INTO placements (slot_id, user_id, source) VALUES ($1::uuid, $2::uuid, 'admin')",
      [slotId, owner.id],
    );
    const publicWall = await app.inject(`/walls/${id}`);
    expect(publicWall.json().slots[0]).toMatchObject({
      occupied: true,
      currentPlacement: { source: 'admin' },
    });
    expect(publicWall.body).not.toContain(owner.id);
    expect((await action(id, ownerToken, 'pause')).json().status).toBe(
      'paused',
    );
    expect((await action(id, ownerToken, 'resume')).json().status).toBe('live');
    expect((await action(id, ownerToken, 'end')).json().status).toBe('ended');
    expect((await action(id, ownerToken, 'archive')).json().status).toBe(
      'archived',
    );
    expect((await app.inject(`/walls/${id}`)).statusCode).toBe(404);
    expect(
      (await app.inject('/creators/creator-one')).json().walls,
    ).toHaveLength(0);
  });

  it('serializes concurrent transitions on the same Wall', async () => {
    const { creator, ownerToken } = await fixture();
    const id = (await create(creator.id, ownerToken)).json().id as string;
    expect((await action(id, ownerToken, 'publish')).statusCode).toBe(200);
    const results = await Promise.all([
      action(id, ownerToken, 'pause'),
      action(id, ownerToken, 'end'),
    ]);
    expect(
      results.find(
        (result) =>
          result.statusCode === 200 && result.json().status === 'ended',
      ),
    ).toBeDefined();
    expect(
      results.every(
        (result) => result.statusCode === 200 || result.statusCode === 409,
      ),
    ).toBe(true);
    const stored = await database.pool.query<{ status: string }>(
      'SELECT status FROM walls WHERE id = $1::uuid',
      [id],
    );
    expect(stored.rows[0]?.status).toBe('ended');
  });

  it('validates input and handles creators without owners', async () => {
    const { creator, ownerToken } = await fixture();
    expect(
      (await create(creator.id, ownerToken, { slotCount: 0 })).statusCode,
    ).toBe(400);
    expect(
      (
        await create(creator.id, ownerToken, {
          slotCount: 1,
          startAt: 'yesterday',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await create(creator.id, ownerToken, {
          slotCount: 1,
          startAt: '2026-09-29T00:00:00Z',
          endAt: '2026-09-28T00:00:00Z',
        })
      ).statusCode,
    ).toBe(400);
    expect((await create('not-a-uuid', ownerToken)).statusCode).toBe(400);
    await database.pool.query(
      'UPDATE creators SET owner_user_id = NULL WHERE id = $1::uuid',
      [creator.id],
    );
    expect((await create(creator.id, ownerToken)).statusCode).toBe(403);
    const [withoutProfile] = await database.db
      .insert(creators)
      .values({ ownerUserId: null })
      .returning();
    if (!withoutProfile) throw new Error('Expected creator');
    expect(
      (await app.inject(`/creators/${withoutProfile.id}`)).statusCode,
    ).toBe(404);
  });
});
