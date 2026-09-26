import {
  creators,
  placements,
  slots,
  socialIdentities,
  users,
  walls,
} from '../../packages/db/src/schema';

// Explicit IDs make relationships and failure cases repeatable; production IDs default to PostgreSQL.
export function fixtureId(number: number): string {
  return `00000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`;
}

export function userFixture(number: number): typeof users.$inferInsert {
  return { id: fixtureId(1000 + number) };
}

export function socialIdentityFixture(
  userId: string,
  number: number,
): typeof socialIdentities.$inferInsert {
  return {
    id: fixtureId(2000 + number),
    userId,
    provider: 'google',
    providerUserId: `provider-user-${number}`,
  };
}

export function creatorFixture(
  number: number,
  ownerUserId?: string,
): typeof creators.$inferInsert {
  return { id: fixtureId(3000 + number), ownerUserId };
}

export function wallFixture(
  creatorId: string,
  number: number,
): typeof walls.$inferInsert {
  return { id: fixtureId(4000 + number), creatorId, slotCount: 1 };
}

export function slotFixture(
  wallId: string,
  number: number,
  position = 0,
): typeof slots.$inferInsert {
  return { id: fixtureId(5000 + number), wallId, position };
}

export function placementFixture(
  slotId: string,
  userId: string,
  number: number,
): typeof placements.$inferInsert {
  return {
    id: fixtureId(6000 + number),
    slotId,
    userId,
    source: 'free_claim',
  };
}
