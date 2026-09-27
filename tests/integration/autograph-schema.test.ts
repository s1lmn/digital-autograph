import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../packages/db/src/index';
import {
  autographAssets,
  autographs,
  placements,
  slots,
  users,
  walls,
  creators,
} from '../../packages/db/src/schema';
import { userFixture } from './fixtures';

const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/autograph_test') {
  throw new Error(
    'Autograph schema tests require the isolated autograph_test database',
  );
}
const database = createDatabase(url);

async function pgError(operation: Promise<unknown>, code: string) {
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

describe('Autograph schema constraints', () => {
  beforeAll(async () => database.checkConnection());
  beforeEach(async () => database.pool.query('TRUNCATE TABLE users CASCADE'));
  afterAll(async () => database.close());

  it('requires an owner, constrains enum values and one original asset', async () => {
    const [user] = await database.db
      .insert(users)
      .values(userFixture(1))
      .returning();
    if (!user) throw new Error('Expected user');
    await pgError(
      database.pool.query(
        "INSERT INTO autographs (user_id, source) VALUES (gen_random_uuid(), 'photo')",
      ),
      '23503',
    );
    await pgError(
      database.pool.query(
        "INSERT INTO autographs (user_id, source) VALUES ($1::uuid, 'svg')",
        [user.id],
      ),
      '22P02',
    );
    const [autograph] = await database.db
      .insert(autographs)
      .values({ userId: user.id, source: 'photo' })
      .returning();
    if (!autograph) throw new Error('Expected autograph');
    const first = {
      autographId: autograph.id,
      role: 'original' as const,
      storageKey: 'autographs/opaque-1/original/opaque-1',
      expectedContentType: 'image/png',
      expectedSizeBytes: 4,
      uploadExpiresAt: new Date(Date.now() + 300_000),
    };
    await database.db.insert(autographAssets).values(first);
    await pgError(
      database.db
        .insert(autographAssets)
        .values({ ...first, storageKey: 'another-key' }),
      '23505',
    );
    const [second] = await database.db
      .insert(autographs)
      .values({ userId: user.id, source: 'canvas' })
      .returning();
    if (!second) throw new Error('Expected second autograph');
    await pgError(
      database.db
        .insert(autographAssets)
        .values({ ...first, autographId: second.id, storageKey: ' ' }),
      '23514',
    );
    await pgError(
      database.pool.query(
        "INSERT INTO autograph_assets (autograph_id, role, storage_key, expected_content_type, expected_size_bytes, upload_expires_at) VALUES ($1::uuid, 'original', 'invalid-type', 'image/svg+xml', 4, now() + interval '5 minutes')",
        [second.id],
      ),
      '23514',
    );
  });

  it('keeps Placement autograph reference nullable and enforces its foreign key', async () => {
    const [user] = await database.db
      .insert(users)
      .values(userFixture(1))
      .returning();
    if (!user) throw new Error('Expected user');
    const [creator] = await database.db
      .insert(creators)
      .values({ ownerUserId: user.id })
      .returning();
    if (!creator) throw new Error('Expected creator');
    const [wall] = await database.db
      .insert(walls)
      .values({ creatorId: creator.id, slotCount: 2 })
      .returning();
    if (!wall) throw new Error('Expected wall');
    const [slot] = await database.db
      .insert(slots)
      .values({ wallId: wall.id, position: 0 })
      .returning();
    if (!slot) throw new Error('Expected slot');
    const [secondSlot] = await database.db
      .insert(slots)
      .values({ wallId: wall.id, position: 1 })
      .returning();
    if (!secondSlot) throw new Error('Expected second slot');
    const [placement] = await database.db
      .insert(placements)
      .values({ slotId: slot.id, userId: user.id, source: 'admin' })
      .returning();
    expect(placement?.autographId).toBeNull();
    await pgError(
      database.pool.query(
        "INSERT INTO placements (slot_id, user_id, source, autograph_id) VALUES ($1::uuid, $2::uuid, 'admin', gen_random_uuid())",
        [secondSlot.id, user.id],
      ),
      '23503',
    );
  });
});
