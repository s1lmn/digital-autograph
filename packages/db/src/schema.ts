import {
  administrativeRoles,
  placementSources,
  userStatuses,
  wallStatuses,
} from '@digital-autograph/domain';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').defaultRandom().primaryKey();
const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const userStatus = pgEnum('user_status', userStatuses);
export const wallStatus = pgEnum('wall_status', wallStatuses);
export const placementSource = pgEnum('placement_source', placementSources);
export const administrativeRole = pgEnum(
  'administrative_role',
  administrativeRoles,
);

export const users = pgTable('users', {
  id: id(),
  status: userStatus().notNull().default('active'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: administrativeRole().notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.role] })],
);

export const socialIdentities = pgTable(
  'social_identities',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    provider: varchar('provider', { length: 64 }).notNull(),
    providerUserId: text('provider_user_id').notNull(),
    providerUsername: text('provider_username'),
    linkedAt: timestamp('linked_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('social_identities_provider_user_uidx').on(
      table.provider,
      table.providerUserId,
    ),
    index('social_identities_user_idx').on(table.userId),
    check(
      'social_identities_provider_nonblank',
      sql`length(btrim(${table.provider})) > 0`,
    ),
    check(
      'social_identities_provider_user_id_nonblank',
      sql`length(btrim(${table.providerUserId})) > 0`,
    ),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    secretHash: text('secret_hash').notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('sessions_secret_hash_uidx').on(table.secretHash),
    index('sessions_user_idx').on(table.userId),
    check(
      'sessions_secret_hash_nonblank',
      sql`length(btrim(${table.secretHash})) > 0`,
    ),
    check(
      'sessions_expires_after_create',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      'sessions_revoked_after_create',
      sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const oauthLoginAttempts = pgTable(
  'oauth_login_attempts',
  {
    id: id(),
    provider: varchar('provider', { length: 64 }).notNull(),
    stateHash: text('state_hash').notNull(),
    browserBindingHash: text('browser_binding_hash').notNull(),
    nonceHash: text('nonce_hash').notNull(),
    pkceVerifierHash: text('pkce_verifier_hash'),
    returnPath: text('return_path').notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('oauth_login_attempts_state_hash_uidx').on(table.stateHash),
    index('oauth_login_attempts_expires_idx').on(table.expiresAt),
    check(
      'oauth_login_attempts_expires_after_create',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      'oauth_login_attempts_consumed_after_create',
      sql`${table.consumedAt} IS NULL OR ${table.consumedAt} >= ${table.createdAt}`,
    ),
    check(
      'oauth_login_attempts_provider_nonblank',
      sql`length(btrim(${table.provider})) > 0`,
    ),
    check(
      'oauth_login_attempts_pkce_hash_nonblank',
      sql`${table.pkceVerifierHash} IS NULL OR length(btrim(${table.pkceVerifierHash})) > 0`,
    ),
    check(
      'oauth_login_attempts_return_path_local',
      sql`left(${table.returnPath}, 1) = '/' AND left(${table.returnPath}, 2) <> '//'`,
    ),
  ],
);

export const consentRecords = pgTable(
  'consent_records',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    documentType: varchar('document_type', { length: 64 }).notNull(),
    documentVersion: varchar('document_version', { length: 64 }).notNull(),
    source: varchar('source', { length: 64 }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('consent_records_user_type_time_idx').on(
      table.userId,
      table.documentType,
      table.acceptedAt,
    ),
    check(
      'consent_records_type_nonblank',
      sql`length(btrim(${table.documentType})) > 0`,
    ),
    check(
      'consent_records_version_nonblank',
      sql`length(btrim(${table.documentVersion})) > 0`,
    ),
  ],
);

export const creators = pgTable(
  'creators',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('creators_owner_user_idx').on(table.ownerUserId)],
);

export const creatorProfiles = pgTable(
  'creator_profiles',
  {
    creatorId: uuid('creator_id')
      .primaryKey()
      .references(() => creators.id, { onDelete: 'restrict' }),
    slug: varchar('slug', { length: 128 }).notNull(),
    displayName: varchar('display_name', { length: 200 }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('creator_profiles_slug_uidx').on(table.slug),
    check(
      'creator_profiles_slug_format',
      sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check(
      'creator_profiles_name_nonblank',
      sql`length(btrim(${table.displayName})) > 0`,
    ),
  ],
);

export const walls = pgTable(
  'walls',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id, { onDelete: 'restrict' }),
    status: wallStatus().notNull().default('draft'),
    startAt: timestamp('start_at', { withTimezone: true }),
    endAt: timestamp('end_at', { withTimezone: true }),
    slotCount: integer('slot_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('walls_creator_created_idx').on(table.creatorId, table.createdAt),
    index('walls_status_start_idx').on(table.status, table.startAt),
    check('walls_slot_count_nonnegative', sql`${table.slotCount} >= 0`),
    check(
      'walls_end_after_start',
      sql`${table.startAt} IS NULL OR ${table.endAt} IS NULL OR ${table.endAt} > ${table.startAt}`,
    ),
  ],
);

export const slots = pgTable(
  'slots',
  {
    id: id(),
    wallId: uuid('wall_id')
      .notNull()
      .references(() => walls.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('slots_wall_position_uidx').on(table.wallId, table.position),
    check('slots_position_nonnegative', sql`${table.position} >= 0`),
  ],
);

export const placements = pgTable(
  'placements',
  {
    id: id(),
    slotId: uuid('slot_id')
      .notNull()
      .references(() => slots.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    source: placementSource().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endReason: text('end_reason'),
  },
  (table) => [
    uniqueIndex('placements_one_active_per_slot_uidx')
      .on(table.slotId)
      .where(sql`${table.endedAt} IS NULL`),
    index('placements_slot_history_idx').on(table.slotId, table.startedAt),
    index('placements_user_started_idx').on(table.userId, table.startedAt),
    check(
      'placements_end_consistency',
      sql`(${table.endedAt} IS NULL AND ${table.endReason} IS NULL) OR (${table.endedAt} IS NOT NULL AND ${table.endReason} IS NOT NULL AND length(btrim(${table.endReason})) > 0 AND ${table.endedAt} >= ${table.startedAt})`,
    ),
  ],
);
