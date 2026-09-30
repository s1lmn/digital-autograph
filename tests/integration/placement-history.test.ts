import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApi } from '../../apps/api/src/app';
import { SessionService } from '../../packages/auth/src/index';
import {
  createDatabase,
  createPgPlacementHistoryRepository,
  createPgSessionRepository,
} from '../../packages/db/src/index';
import { PlacementHistoryService } from '../../packages/walls/src/index';

const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/autograph_test') {
  throw new Error(
    'Placement history tests require isolated autograph_test database',
  );
}

const database = createDatabase(url);
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
  new PlacementHistoryService(
    createPgPlacementHistoryRepository(database.pool),
  ),
);

type User = { id: string; token: string };

async function createUser(): Promise<User> {
  const id = randomUUID();
  await database.pool.query('INSERT INTO users (id) VALUES ($1::uuid)', [id]);
  const session = await sessions.createSession(id);
  return { id, token: session.token };
}

async function createWall() {
  const creatorId = randomUUID();
  const wallId = randomUUID();
  const slotId = randomUUID();
  const ownerId = randomUUID();
  await database.pool.query('INSERT INTO users (id) VALUES ($1::uuid)', [
    ownerId,
  ]);
  await database.pool.query(
    'INSERT INTO creators (id, owner_user_id) VALUES ($1::uuid, $2::uuid)',
    [creatorId, ownerId],
  );
  await database.pool.query(
    `INSERT INTO creator_profiles (creator_id, slug, display_name)
     VALUES ($1::uuid, $2, 'History Creator')`,
    [creatorId, `history-${creatorId}`],
  );
  await database.pool.query(
    `INSERT INTO walls (id, creator_id, status, slot_count)
     VALUES ($1::uuid, $2::uuid, 'live', 1)`,
    [wallId, creatorId],
  );
  await database.pool.query(
    `INSERT INTO slots (id, wall_id, position) VALUES ($1::uuid, $2::uuid, 0)`,
    [slotId, wallId],
  );
  return { wallId, slotId };
}

async function createPlacement(
  slotId: string,
  userId: string,
  startedAt: Date,
  endedAt: Date | null,
  endReason: string | null,
) {
  const id = randomUUID();
  await database.pool.query(
    `INSERT INTO placements
       (id, slot_id, user_id, source, started_at, ended_at, end_reason)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'free_claim',
             $4::timestamptz, $5::timestamptz, $6)`,
    [id, slotId, userId, startedAt, endedAt, endReason],
  );
}

beforeAll(async () => {
  const [previousUser, currentUser] = await Promise.all([
    createUser(),
    createUser(),
  ]);
  const { wallId, slotId } = await createWall();
  await createPlacement(
    slotId,
    previousUser.id,
    new Date('2026-09-28T12:00:00.000Z'),
    new Date('2026-09-29T12:00:00.000Z'),
    'untrusted private details',
  );
  await createPlacement(
    slotId,
    currentUser.id,
    new Date('2026-09-30T12:00:00.000Z'),
    null,
    null,
  );
  Object.assign(fixture, { previousUser, currentUser, wallId });
});

const fixture: {
  previousUser?: User;
  currentUser?: User;
  wallId?: string;
} = {};

afterAll(async () => {
  await app.close();
  await database.close();
});

describe('Placement history read models', () => {
  it('reconstructs a public Wall history without disclosing holder identifiers', async () => {
    const wallId = fixture.wallId;
    if (!wallId) throw new Error('Wall fixture was not initialized');
    const response = await app.inject(`/walls/${wallId}/placements`);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.wallId).toBe(wallId);
    expect(body.placements).toMatchObject([
      { slotPosition: 0, source: 'free_claim', endedAt: null, endReason: null },
      { slotPosition: 0, source: 'free_claim', endReason: 'other' },
    ]);
    expect(response.body).not.toContain(fixture.previousUser?.id);
    expect(response.body).not.toContain(fixture.currentUser?.id);
    expect(response.body).not.toContain('untrusted private details');
    expect(response.body).not.toContain('user_id');
  });

  it('returns only the authenticated User own placements', async () => {
    const previousUser = fixture.previousUser;
    if (!previousUser || !fixture.wallId)
      throw new Error('Placement history fixture was not initialized');
    const response = await app.inject({
      url: '/me/placements',
      headers: { cookie: `da_session=${previousUser.token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    expect(response.json().items[0]).toMatchObject({
      wallId: fixture.wallId,
      wallDisplayName: 'History Creator',
      slotPosition: 0,
      source: 'free_claim',
      endReason: 'other',
    });
    expect(response.body).not.toContain(fixture.currentUser?.id);
  });

  it('requires authentication for personal history and hides non-public Wall history', async () => {
    const wallId = fixture.wallId;
    if (!wallId) throw new Error('Wall fixture was not initialized');
    const anonymous = await app.inject('/me/placements');
    expect(anonymous.statusCode).toBe(401);

    await database.pool.query(
      "UPDATE walls SET status = 'draft' WHERE id = $1::uuid",
      [wallId],
    );
    const privateHistory = await app.inject(`/walls/${wallId}/placements`);
    expect(privateHistory.statusCode).toBe(404);
  });
});
