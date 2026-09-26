import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, eq } from '../../packages/db/src/index';
import {
  consentRecords,
  creatorProfiles,
  creators,
  placements,
  sessions,
  slots,
  socialIdentities,
  users,
  walls,
} from '../../packages/db/src/schema';
import {
  creatorFixture,
  fixtureId,
  placementFixture,
  slotFixture,
  socialIdentityFixture,
  userFixture,
  wallFixture,
} from './fixtures';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (
  !testDatabaseUrl ||
  new URL(testDatabaseUrl).pathname !== '/autograph_test'
) {
  throw new Error(
    'Domain integration tests require the isolated autograph_test database',
  );
}

const database = createDatabase(testDatabaseUrl);
const db = database.db;

function required<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) throw new Error('Expected one returned database row');
  return row;
}

async function expectPgError(operation: Promise<unknown>, code: string) {
  try {
    await operation;
    throw new Error(`Expected PostgreSQL error ${code}`);
  } catch (error) {
    let current: unknown = error;
    while (current instanceof Error) {
      if ('code' in current && current.code === code) return;
      current = current.cause;
    }
    throw error;
  }
}

async function makeWorld() {
  const user = required(
    await db.insert(users).values(userFixture(1)).returning(),
  );
  const creator = required(
    await db.insert(creators).values(creatorFixture(1, user.id)).returning(),
  );
  const wall = required(
    await db.insert(walls).values(wallFixture(creator.id, 1)).returning(),
  );
  const slot = required(
    await db.insert(slots).values(slotFixture(wall.id, 1)).returning(),
  );
  return { user, creator, wall, slot };
}

describe('domain schema constraints', () => {
  beforeAll(async () => database.checkConnection());
  beforeEach(async () => {
    await database.pool.query(
      'TRUNCATE TABLE placements, slots, walls, creator_profiles, creators, consent_records, sessions, social_identities, users CASCADE',
    );
  });
  afterAll(async () => database.close());

  it('creates a user with a database-generated UUID and timestamps', async () => {
    const user = required(await db.insert(users).values({}).returning());
    expect(user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(user.status).toBe('active');
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.updatedAt).toBeInstanceOf(Date);
    await database.pool.query('SELECT pg_sleep(0.01)');
    const changed = required(
      await db
        .update(users)
        .set({ status: 'disabled' })
        .where(eq(users.id, user.id))
        .returning(),
    );
    expect(changed.updatedAt.getTime()).toBeGreaterThan(
      user.updatedAt.getTime(),
    );
  });

  it('links a provider identity to one user and enforces provider-specific uniqueness', async () => {
    const first = required(
      await db.insert(users).values(userFixture(1)).returning(),
    );
    const second = required(
      await db.insert(users).values(userFixture(2)).returning(),
    );
    await db
      .insert(socialIdentities)
      .values(socialIdentityFixture(first.id, 1));
    await expectPgError(
      db.insert(socialIdentities).values({
        ...socialIdentityFixture(second.id, 2),
        providerUserId: 'provider-user-1',
      }),
      '23505',
    );
    const otherProvider = required(
      await db
        .insert(socialIdentities)
        .values({
          ...socialIdentityFixture(second.id, 2),
          provider: 'telegram',
          providerUserId: 'provider-user-1',
        })
        .returning(),
    );
    expect(otherProvider.userId).toBe(second.id);
    await expectPgError(
      db
        .insert(socialIdentities)
        .values(socialIdentityFixture(fixtureId(999), 3)),
      '23503',
    );
  });

  it('persists hashed session material, expiry and revocation with a valid user', async () => {
    const user = required(
      await db.insert(users).values(userFixture(1)).returning(),
    );
    const expiresAt = new Date(Date.now() + 86_400_000);
    const session = required(
      await db
        .insert(sessions)
        .values({ userId: user.id, secretHash: 'test-hash-1', expiresAt })
        .returning(),
    );
    expect(session.userId).toBe(user.id);
    expect(session.secretHash).toBe('test-hash-1');
    expect(session.expiresAt).toEqual(expiresAt);
    expect(session.revokedAt).toBeNull();
    const revoked = required(
      await db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.id, session.id))
        .returning(),
    );
    expect(revoked.revokedAt).toBeInstanceOf(Date);
    await expectPgError(
      db.insert(sessions).values({
        userId: fixtureId(999),
        secretHash: 'test-hash-2',
        expiresAt,
      }),
      '23503',
    );
  });

  it('retains versioned consent and prevents mutation of prior records', async () => {
    const user = required(
      await db.insert(users).values(userFixture(1)).returning(),
    );
    const first = required(
      await db
        .insert(consentRecords)
        .values({
          userId: user.id,
          documentType: 'terms',
          documentVersion: 'v1',
          source: 'web',
        })
        .returning(),
    );
    await db.insert(consentRecords).values({
      userId: user.id,
      documentType: 'terms',
      documentVersion: 'v2',
      source: 'web',
    });
    const records = await db
      .select()
      .from(consentRecords)
      .where(eq(consentRecords.userId, user.id));
    expect(records.map((record) => record.documentVersion)).toEqual([
      'v1',
      'v2',
    ]);
    await expectPgError(
      db
        .update(consentRecords)
        .set({ documentVersion: 'changed' })
        .where(eq(consentRecords.id, first.id)),
      '23514',
    );
    await expectPgError(
      db.delete(consentRecords).where(eq(consentRecords.id, first.id)),
      '23514',
    );
  });

  it('supports an unclaimed creator, optional user owner, and one profile', async () => {
    const user = required(
      await db.insert(users).values(userFixture(1)).returning(),
    );
    const creator = required(
      await db.insert(creators).values(creatorFixture(1)).returning(),
    );
    expect(creator.ownerUserId).toBeNull();
    const claimed = required(
      await db
        .update(creators)
        .set({ ownerUserId: user.id })
        .where(eq(creators.id, creator.id))
        .returning(),
    );
    expect(claimed.ownerUserId).toBe(user.id);
    await db.insert(creatorProfiles).values({
      creatorId: creator.id,
      slug: 'sample-creator',
      displayName: 'Sample Creator',
    });
    await expectPgError(
      db.insert(creators).values(creatorFixture(2, fixtureId(999))),
      '23503',
    );
    await expectPgError(
      db.insert(creatorProfiles).values({
        creatorId: fixtureId(999),
        slug: 'missing',
        displayName: 'Missing',
      }),
      '23503',
    );
  });

  it('persists all wall states and temporal fields, rejecting invalid state and creator', async () => {
    const creator = required(
      await db.insert(creators).values(creatorFixture(1)).returning(),
    );
    const startAt = new Date('2026-10-01T12:00:00.000Z');
    const endAt = new Date('2026-10-02T12:00:00.000Z');
    const states = [
      'draft',
      'scheduled',
      'live',
      'paused',
      'ended',
      'archived',
    ] as const;
    for (const [index, status] of states.entries()) {
      const wall = required(
        await db
          .insert(walls)
          .values({
            ...wallFixture(creator.id, index + 1),
            status,
            startAt,
            endAt,
          })
          .returning(),
      );
      expect(wall.status).toBe(status);
      expect(wall.startAt).toEqual(startAt);
      expect(wall.endAt).toEqual(endAt);
    }
    await expectPgError(
      database.pool.query(
        "INSERT INTO walls (creator_id, status) VALUES ($1, 'unknown')",
        [creator.id],
      ),
      '22P02',
    );
    await expectPgError(
      db.insert(walls).values(wallFixture(fixtureId(999), 9)),
      '23503',
    );
    await expectPgError(
      db.insert(walls).values({
        ...wallFixture(creator.id, 10),
        startAt: endAt,
        endAt: startAt,
      }),
      '23514',
    );
  });

  it('enforces unique nonnegative positions per wall and valid wall FK', async () => {
    const creator = required(
      await db.insert(creators).values(creatorFixture(1)).returning(),
    );
    const firstWall = required(
      await db.insert(walls).values(wallFixture(creator.id, 1)).returning(),
    );
    const secondWall = required(
      await db.insert(walls).values(wallFixture(creator.id, 2)).returning(),
    );
    const firstSlot = required(
      await db.insert(slots).values(slotFixture(firstWall.id, 1)).returning(),
    );
    expect(firstSlot.wallId).toBe(firstWall.id);
    await expectPgError(
      db.insert(slots).values(slotFixture(firstWall.id, 2)),
      '23505',
    );
    await db.insert(slots).values(slotFixture(secondWall.id, 3));
    await expectPgError(
      db.insert(slots).values(slotFixture(fixtureId(999), 4)),
      '23503',
    );
    await expectPgError(
      db.insert(slots).values(slotFixture(firstWall.id, 5, -1)),
      '23514',
    );
  });

  it('enforces one active placement, preserves history, and permits another slot', async () => {
    const { user, wall, slot } = await makeWorld();
    const secondUser = required(
      await db.insert(users).values(userFixture(2)).returning(),
    );
    const first = required(
      await db
        .insert(placements)
        .values(placementFixture(slot.id, user.id, 1))
        .returning(),
    );
    await expectPgError(
      db.insert(placements).values(placementFixture(slot.id, secondUser.id, 2)),
      '23505',
    );
    const ended = required(
      await db
        .update(placements)
        .set({ endedAt: new Date(), endReason: 'takeover' })
        .where(eq(placements.id, first.id))
        .returning(),
    );
    expect(ended.endReason).toBe('takeover');
    await db
      .insert(placements)
      .values(placementFixture(slot.id, secondUser.id, 2));
    const otherSlot = required(
      await db
        .insert(slots)
        .values(slotFixture(wall.id, 2, 1))
        .returning(),
    );
    await db
      .insert(placements)
      .values(placementFixture(otherSlot.id, user.id, 3));
    const history = await db
      .select()
      .from(placements)
      .where(eq(placements.slotId, slot.id));
    expect(history).toHaveLength(2);
    expect(history.find((row) => row.id === first.id)?.endedAt).toBeInstanceOf(
      Date,
    );
    expect(
      history.find((row) => row.userId === secondUser.id)?.endedAt,
    ).toBeNull();
    await expectPgError(
      db
        .update(placements)
        .set({ endReason: 'rewritten' })
        .where(eq(placements.id, first.id)),
      '23514',
    );
    await expectPgError(
      db.delete(placements).where(eq(placements.id, first.id)),
      '23514',
    );
  });

  it('rejects missing placement relations and inconsistent completion', async () => {
    const { user, slot } = await makeWorld();
    await expectPgError(
      db
        .insert(placements)
        .values(placementFixture(fixtureId(999), user.id, 1)),
      '23503',
    );
    await expectPgError(
      db
        .insert(placements)
        .values(placementFixture(slot.id, fixtureId(999), 2)),
      '23503',
    );
    await expectPgError(
      db.insert(placements).values({
        ...placementFixture(slot.id, user.id, 3),
        endedAt: new Date(),
      }),
      '23514',
    );
  });

  it('restricts deletion of referenced users, creators, walls, and slots', async () => {
    const { user, creator, wall, slot } = await makeWorld();
    await db.insert(placements).values(placementFixture(slot.id, user.id, 1));
    await expectPgError(db.delete(users).where(eq(users.id, user.id)), '23503');
    await expectPgError(
      db.delete(creators).where(eq(creators.id, creator.id)),
      '23503',
    );
    await expectPgError(db.delete(walls).where(eq(walls.id, wall.id)), '23503');
    await expectPgError(db.delete(slots).where(eq(slots.id, slot.id)), '23503');
  });

  it('allows exactly one of two concurrent active placement inserts', async () => {
    const { user, slot } = await makeWorld();
    const secondUser = required(
      await db.insert(users).values(userFixture(2)).returning(),
    );
    const insert = (id: string, userId: string) =>
      database.pool.query(
        "INSERT INTO placements (id, slot_id, user_id, source) VALUES ($1, $2, $3, 'free_claim')",
        [id, slot.id, userId],
      );
    const outcomes = await Promise.allSettled([
      insert(fixtureId(7001), user.id),
      insert(fixtureId(7002), secondUser.id),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === 'rejected'),
    ).toHaveLength(1);
    const failure = outcomes.find((outcome) => outcome.status === 'rejected');
    if (!failure || failure.status !== 'rejected') {
      throw new Error('Expected one rejected concurrent insert');
    }
    await expectPgError(Promise.reject(failure.reason), '23505');
    const active = await db
      .select()
      .from(placements)
      .where(eq(placements.slotId, slot.id));
    expect(active).toHaveLength(1);
  });
});
