import {
  administrativeRoles,
  autographAssetRoles,
  autographAssetStatuses,
  moderationDecisions,
  moderationRejectionReasons,
  autographSources,
  autographStatuses,
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
export const autographSource = pgEnum('autograph_source', autographSources);
export const autographStatus = pgEnum('autograph_status', autographStatuses);
export const autographModerationDecision = pgEnum(
  'autograph_moderation_decision',
  moderationDecisions,
);
export const autographModerationReason = pgEnum(
  'autograph_moderation_reason',
  moderationRejectionReasons,
);
export const autographAssetRole = pgEnum(
  'autograph_asset_role',
  autographAssetRoles,
);
export const autographAssetStatus = pgEnum(
  'autograph_asset_status',
  autographAssetStatuses,
);
export const autographProcessingJobStatus = pgEnum(
  'autograph_processing_job_status',
  ['queued', 'processing', 'succeeded', 'failed'],
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

export const autographs = pgTable(
  'autographs',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    source: autographSource().notNull(),
    status: autographStatus().notNull().default('draft'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('autographs_user_created_idx').on(table.userId, table.createdAt),
  ],
);

export const autographAssets = pgTable(
  'autograph_assets',
  {
    id: id(),
    autographId: uuid('autograph_id')
      .notNull()
      .references(() => autographs.id, { onDelete: 'restrict' }),
    role: autographAssetRole().notNull(),
    status: autographAssetStatus().notNull().default('reserved'),
    storageKey: text('storage_key').notNull(),
    expectedContentType: varchar('expected_content_type', {
      length: 64,
    }),
    expectedSizeBytes: integer('expected_size_bytes'),
    verifiedSizeBytes: integer('verified_size_bytes'),
    uploadExpiresAt: timestamp('upload_expires_at', {
      withTimezone: true,
    }),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
    actualContentType: varchar('actual_content_type', { length: 64 }),
    width: integer('width'),
    height: integer('height'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('autograph_assets_one_original_uidx')
      .on(table.autographId)
      .where(sql`${table.role} = 'original'`),
    uniqueIndex('autograph_assets_one_cleaned_uidx')
      .on(table.autographId)
      .where(sql`${table.role} <> 'original'`),
    uniqueIndex('autograph_assets_storage_key_uidx').on(table.storageKey),
    check(
      'autograph_assets_storage_key_nonblank',
      sql`length(btrim(${table.storageKey})) > 0`,
    ),
    check(
      'autograph_assets_expected_size_valid',
      sql`${table.expectedSizeBytes} IS NULL OR ${table.expectedSizeBytes} BETWEEN 1 AND 10485760`,
    ),
    check(
      'autograph_assets_verified_size_valid',
      sql`${table.verifiedSizeBytes} IS NULL OR ${table.verifiedSizeBytes} BETWEEN 1 AND 10485760`,
    ),
    check(
      'autograph_assets_expected_type_valid',
      sql`${table.expectedContentType} IS NULL OR ${table.expectedContentType} IN ('image/png', 'image/jpeg')`,
    ),
    check(
      'autograph_assets_expires_after_create',
      sql`${table.uploadExpiresAt} IS NULL OR ${table.uploadExpiresAt} > ${table.createdAt}`,
    ),
    check(
      'autograph_assets_state_consistency',
      sql`(${table.role} = 'original' AND ${table.expectedContentType} IS NOT NULL AND ${table.expectedSizeBytes} IS NOT NULL AND ${table.uploadExpiresAt} IS NOT NULL AND ${table.actualContentType} IS NULL AND ${table.width} IS NULL AND ${table.height} IS NULL AND ((${table.status} = 'reserved' AND ${table.uploadedAt} IS NULL AND ${table.verifiedSizeBytes} IS NULL) OR (${table.status} = 'uploaded' AND ${table.uploadedAt} IS NOT NULL AND ${table.verifiedSizeBytes} IS NOT NULL))) OR (${table.role} <> 'original' AND ${table.status} = 'uploaded' AND ${table.expectedContentType} IS NULL AND ${table.expectedSizeBytes} IS NULL AND ${table.uploadExpiresAt} IS NULL AND ${table.actualContentType} = 'image/png' AND ${table.verifiedSizeBytes} BETWEEN 1 AND 10485760 AND ${table.width} BETWEEN 1 AND 2048 AND ${table.height} BETWEEN 1 AND 2048 AND ${table.uploadedAt} IS NOT NULL)`,
    ),
  ],
);

export const autographUserApprovals = pgTable(
  'autograph_user_approvals',
  {
    id: id(),
    autographId: uuid('autograph_id')
      .notNull()
      .references(() => autographs.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    cleanedAssetId: uuid('cleaned_asset_id')
      .notNull()
      .references(() => autographAssets.id, { onDelete: 'restrict' }),
    approvedAt: timestamp('approved_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('autograph_user_approvals_autograph_uidx').on(
      table.autographId,
    ),
    index('autograph_user_approvals_user_idx').on(table.userId),
    index('autograph_user_approvals_cleaned_asset_idx').on(
      table.cleanedAssetId,
    ),
  ],
);

export const autographModerationDecisions = pgTable(
  'autograph_moderation_decisions',
  {
    id: id(),
    autographId: uuid('autograph_id')
      .notNull()
      .references(() => autographs.id, { onDelete: 'restrict' }),
    moderatorUserId: uuid('moderator_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    userApprovalId: uuid('user_approval_id')
      .notNull()
      .references(() => autographUserApprovals.id, { onDelete: 'restrict' }),
    cleanedAssetId: uuid('cleaned_asset_id')
      .notNull()
      .references(() => autographAssets.id, { onDelete: 'restrict' }),
    decision: autographModerationDecision().notNull(),
    reasonCode: autographModerationReason('reason_code'),
    decidedAt: timestamp('decided_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('autograph_moderation_decisions_autograph_uidx').on(
      table.autographId,
    ),
    index('autograph_moderation_decisions_moderator_idx').on(
      table.moderatorUserId,
    ),
    check(
      'autograph_moderation_decisions_reason_check',
      sql`(${table.decision} = 'approved' AND ${table.reasonCode} IS NULL) OR (${table.decision} = 'rejected' AND ${table.reasonCode} IS NOT NULL)`,
    ),
  ],
);

export const autographProcessingJobs = pgTable(
  'autograph_processing_jobs',
  {
    id: id(),
    autographId: uuid('autograph_id')
      .notNull()
      .references(() => autographs.id, { onDelete: 'restrict' }),
    originalAssetId: uuid('original_asset_id')
      .notNull()
      .references(() => autographAssets.id, { onDelete: 'restrict' }),
    status: autographProcessingJobStatus().notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    leaseToken: uuid('lease_token'),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    failureCode: varchar('failure_code', { length: 64 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('autograph_processing_jobs_one_active_uidx')
      .on(table.autographId)
      .where(sql`${table.status} IN ('queued', 'processing')`),
    index('autograph_processing_jobs_claim_idx').on(
      table.status,
      table.availableAt,
    ),
    check(
      'autograph_processing_jobs_attempts_valid',
      sql`${table.attempts} BETWEEN 0 AND 3`,
    ),
    check(
      'autograph_processing_jobs_state_consistency',
      sql`(${table.status} = 'queued' AND ${table.leaseToken} IS NULL AND ${table.claimedAt} IS NULL AND ${table.finishedAt} IS NULL) OR (${table.status} = 'processing' AND ${table.leaseToken} IS NOT NULL AND ${table.claimedAt} IS NOT NULL AND ${table.finishedAt} IS NULL) OR (${table.status} IN ('succeeded', 'failed') AND ${table.leaseToken} IS NULL AND ${table.claimedAt} IS NULL AND ${table.finishedAt} IS NOT NULL)`,
    ),
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
    autographId: uuid('autograph_id').references(() => autographs.id, {
      onDelete: 'restrict',
    }),
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
    index('placements_autograph_idx').on(table.autographId),
    check(
      'placements_end_consistency',
      sql`(${table.endedAt} IS NULL AND ${table.endReason} IS NULL) OR (${table.endedAt} IS NOT NULL AND ${table.endReason} IS NOT NULL AND length(btrim(${table.endReason})) > 0 AND ${table.endedAt} >= ${table.startedAt})`,
    ),
  ],
);

export const wallFreeClaims = pgTable(
  'wall_free_claims',
  {
    id: id(),
    wallId: uuid('wall_id')
      .notNull()
      .references(() => walls.id, { onDelete: 'restrict' }),
    slotId: uuid('slot_id')
      .notNull()
      .references(() => slots.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    autographId: uuid('autograph_id')
      .notNull()
      .references(() => autographs.id, { onDelete: 'restrict' }),
    placementId: uuid('placement_id')
      .notNull()
      .references(() => placements.id, { onDelete: 'restrict' }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('wall_free_claims_wall_user_uidx').on(
      table.wallId,
      table.userId,
    ),
    uniqueIndex('wall_free_claims_placement_uidx').on(table.placementId),
    index('wall_free_claims_user_time_idx').on(table.userId, table.claimedAt),
    index('wall_free_claims_slot_idx').on(table.slotId),
    index('wall_free_claims_autograph_idx').on(table.autographId),
  ],
);
