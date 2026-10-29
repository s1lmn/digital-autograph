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
  bigint,
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
  boolean,
  jsonb,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').defaultRandom().primaryKey();
const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id),
    web: boolean('web').notNull().default(true),
    telegram: boolean('telegram').notNull().default(false),
    mutedKinds: jsonb('muted_kinds').$type<string[]>().notNull().default([]),
    chatId: text('chat_id'),
    consentAt: timestamp('consent_at', { withTimezone: true }),
    linkHash: text('link_hash'),
    linkExpiresAt: timestamp('link_expires_at', { withTimezone: true }),
    linkedAt: timestamp('linked_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('notification_chat_uidx').on(t.chatId),
    check(
      'notification_telegram_consent',
      sql`NOT ${t.telegram} OR (${t.chatId} IS NOT NULL AND ${t.consentAt} IS NOT NULL)`,
    ),
  ],
);
export const notificationSubscriptions = pgTable(
  'notification_subscriptions',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    wallId: uuid('wall_id')
      .notNull()
      .references(() => walls.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.wallId] })],
);
export const notificationEvents = pgTable(
  'notification_events',
  {
    id: id(),
    sourceKey: text('source_key').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull(),
    wallId: uuid('wall_id')
      .notNull()
      .references(() => walls.id),
    slotId: uuid('slot_id').references(() => slots.id),
    detail: text('detail'),
    createdAt: createdAt(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('notification_event_source_uidx').on(t.sourceKey),
    index('notification_event_pending_idx').on(t.processedAt, t.createdAt),
  ],
);
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: id(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => notificationEvents.id),
    channel: text('channel').notNull(),
    state: text('state').notNull(),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseToken: uuid('lease_token'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    attemptAt: timestamp('attempt_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('notification_delivery_identity').on(t.eventId, t.channel),
    index('notification_delivery_queue').on(t.state, t.availableAt),
    check(
      'notification_delivery_state',
      sql`${t.channel} IN ('web','telegram') AND ${t.state} IN ('queued','sending','sent','retry','uncertain','failed','suppressed') AND ${t.attempts} BETWEEN 0 AND 5`,
    ),
  ],
);
export const shareLinks = pgTable(
  'share_links',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    wallId: uuid('wall_id')
      .notNull()
      .references(() => walls.id),
    slotId: uuid('slot_id').references(() => slots.id),
    placementId: uuid('placement_id').references(() => placements.id),
    publicAlias: varchar('public_alias', { length: 40 }),
    event: text('event').notNull(),
    createdAt: createdAt(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('share_links_user_time_idx').on(t.userId, t.createdAt)],
);
export const shareInteractions = pgTable(
  'share_interactions',
  {
    shareId: uuid('share_id')
      .notNull()
      .references(() => shareLinks.id),
    kind: text('kind').notNull(),
    dedupeKey: uuid('dedupe_key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.shareId, t.kind, t.dedupeKey] }),
    check(
      'share_interaction_kind',
      sql`${t.kind} IN ('share_clicked','referral_arrived')`,
    ),
  ],
);

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
export const takeoverReservationStatus = pgEnum('takeover_reservation_status', [
  'active',
  'expired',
  'cancelled',
  'consumed',
]);

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

export const legalEvidenceEvents = pgTable(
  'legal_evidence_events',
  {
    id: id(),
    sequence: bigint('sequence', { mode: 'bigint' })
      .notNull()
      .generatedAlwaysAsIdentity(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    documentType: varchar('document_type', { length: 64 }).notNull(),
    documentVersion: varchar('document_version', { length: 64 }).notNull(),
    documentHash: varchar('document_hash', { length: 64 }).notNull(),
    action: varchar('action', { length: 16 }).notNull(),
    source: varchar('source', { length: 64 }).notNull(),
    context: varchar('context', { length: 64 }).notNull(),
    purpose: varchar('purpose', { length: 64 }).notNull().default('contract'),
    scope:
      jsonb('scope').$type<import('@digital-autograph/domain').LegalScope>(),
    previousEventId: uuid('previous_event_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    uniqueIndex('legal_evidence_sequence_uidx').on(t.sequence),
    index('legal_evidence_stream_idx').on(
      t.userId,
      t.documentType,
      t.purpose,
      t.sequence,
    ),
    check('legal_evidence_hash', sql`${t.documentHash} ~ '^[a-f0-9]{64}$'`),
    check(
      'legal_evidence_version',
      sql`${t.documentVersion} ~ '^[a-zA-Z0-9._-]{1,64}$'`,
    ),
    check(
      'legal_evidence_context',
      sql`${t.source} ~ '^[a-z][a-z0-9_]{0,63}$' AND ${t.context} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
    check(
      'legal_evidence_semantics',
      sql`(${t.documentType} IN ('terms_of_use','community_guidelines','public_offer','refund_policy') AND ${t.action} = 'accepted' AND ${t.scope} IS NULL AND ${t.purpose} = 'contract') OR (${t.documentType} IN ('personal_data_consent','personal_data_dissemination_consent') AND ${t.action} IN ('granted','withdrawn') AND ${t.scope} IS NOT NULL AND jsonb_typeof(${t.scope}) = 'object' AND (${t.scope}->>'purpose' = ${t.purpose}) IS TRUE AND ${t.purpose} ~ '^[a-z][a-z0-9_]{0,63}$' AND ${t.purpose} <> 'contract')`,
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

export const pricingConfigVersions = pgTable(
  'pricing_config_versions',
  {
    id: id(),
    algorithmVersion: varchar('algorithm_version', { length: 64 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    baseAmountMinor: bigint('base_amount_minor', { mode: 'bigint' }).notNull(),
    minimumAmountMinor: bigint('minimum_amount_minor', {
      mode: 'bigint',
    }).notNull(),
    maximumAmountMinor: bigint('maximum_amount_minor', {
      mode: 'bigint',
    }).notNull(),
    dynamicTakeoverLimit: integer('dynamic_takeover_limit').notNull(),
    takeoverStepSize: integer('takeover_step_size').notNull(),
    stepAmountMinor: bigint('step_amount_minor', { mode: 'bigint' }).notNull(),
    decayIntervalSeconds: integer('decay_interval_seconds').notNull(),
    decayAmountMinor: bigint('decay_amount_minor', {
      mode: 'bigint',
    }).notNull(),
    decayFloorAmountMinor: bigint('decay_floor_amount_minor', {
      mode: 'bigint',
    }).notNull(),
    guaranteedVisibilitySeconds: integer(
      'guaranteed_visibility_seconds',
    ).notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (table) => [
    index('pricing_config_versions_created_idx').on(table.createdAt),
    check(
      'pricing_config_algorithm_v1',
      sql`${table.algorithmVersion} = 'takeover_ladder_v1'`,
    ),
    check('pricing_config_currency_rub', sql`${table.currency} = 'RUB'`),
    check(
      'pricing_config_amounts_valid',
      sql`${table.minimumAmountMinor} BETWEEN 1 AND 100000000000 AND ${table.baseAmountMinor} BETWEEN ${table.minimumAmountMinor} AND ${table.maximumAmountMinor} AND ${table.maximumAmountMinor} <= 100000000000 AND ${table.stepAmountMinor} BETWEEN 0 AND 100000000000 AND ${table.decayAmountMinor} BETWEEN 0 AND 100000000000 AND ${table.decayFloorAmountMinor} BETWEEN ${table.minimumAmountMinor} AND ${table.maximumAmountMinor}`,
    ),
    check(
      'pricing_config_steps_valid',
      sql`${table.dynamicTakeoverLimit} BETWEEN 0 AND 1000000 AND ${table.takeoverStepSize} BETWEEN 1 AND 1000000`,
    ),
    check(
      'pricing_config_time_valid',
      sql`${table.decayIntervalSeconds} BETWEEN 1 AND 2592000 AND ${table.guaranteedVisibilitySeconds} BETWEEN 0 AND 2592000`,
    ),
  ],
);

export const platformPricingDefault = pgTable(
  'platform_pricing_default',
  {
    singletonId: integer('singleton_id').primaryKey().default(1),
    pricingConfigId: uuid('pricing_config_id')
      .notNull()
      .references(() => pricingConfigVersions.id, { onDelete: 'restrict' }),
    updatedAt: updatedAt(),
  },
  (table) => [
    check('platform_pricing_default_singleton', sql`${table.singletonId} = 1`),
  ],
);

export const walls = pgTable(
  'walls',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id, { onDelete: 'restrict' }),
    pricingConfigId: uuid('pricing_config_id').references(
      () => pricingConfigVersions.id,
      { onDelete: 'restrict' },
    ),
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
    index('autographs_created_idx').on(table.createdAt),
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
    uploadAttempts: integer('upload_attempts').notNull().default(0),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    lastIoToken: uuid('last_io_token'),
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
    check(
      'autograph_assets_attempts_check',
      sql`${table.uploadAttempts} BETWEEN 0 AND 5`,
    ),
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

export const takeoverQuotes = pgTable(
  'takeover_quotes',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    wallId: uuid('wall_id')
      .notNull()
      .references(() => walls.id, { onDelete: 'restrict' }),
    slotId: uuid('slot_id')
      .notNull()
      .references(() => slots.id, { onDelete: 'restrict' }),
    targetPlacementId: uuid('target_placement_id')
      .notNull()
      .references(() => placements.id, { onDelete: 'restrict' }),
    pricingConfigId: uuid('pricing_config_id')
      .notNull()
      .references(() => pricingConfigVersions.id, { onDelete: 'restrict' }),
    algorithmVersion: varchar('algorithm_version', { length: 64 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    wallTakeoverCount: bigint('wall_takeover_count', {
      mode: 'bigint',
    }).notNull(),
    lastTakeoverAt: timestamp('last_takeover_at', { withTimezone: true }),
    stepIndex: bigint('step_index', { mode: 'bigint' }).notNull(),
    ladderAmountMinor: bigint('ladder_amount_minor', {
      mode: 'bigint',
    }).notNull(),
    decayIntervalsApplied: bigint('decay_intervals_applied', {
      mode: 'bigint',
    }).notNull(),
    quotedAt: timestamp('quoted_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('takeover_quotes_user_time_idx').on(table.userId, table.quotedAt),
    index('takeover_quotes_slot_time_idx').on(table.slotId, table.quotedAt),
    index('takeover_quotes_target_idx').on(table.targetPlacementId),
    check(
      'takeover_quotes_algorithm_v1',
      sql`${table.algorithmVersion} = 'takeover_ladder_v1'`,
    ),
    check('takeover_quotes_currency_rub', sql`${table.currency} = 'RUB'`),
    check(
      'takeover_quotes_amount_valid',
      sql`${table.amountMinor} BETWEEN 1 AND 100000000000 AND ${table.ladderAmountMinor} BETWEEN ${table.amountMinor} AND 100000000000`,
    ),
    check(
      'takeover_quotes_snapshot_valid',
      sql`${table.wallTakeoverCount} >= 0 AND ${table.stepIndex} >= 0 AND ${table.decayIntervalsApplied} >= 0 AND ((${table.wallTakeoverCount} = 0 AND ${table.lastTakeoverAt} IS NULL) OR (${table.wallTakeoverCount} > 0 AND ${table.lastTakeoverAt} IS NOT NULL))`,
    ),
    check(
      'takeover_quotes_expiry_valid',
      sql`${table.expiresAt} > ${table.quotedAt}`,
    ),
  ],
);

export const takeoverReservations = pgTable(
  'takeover_reservations',
  {
    id: id(),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => takeoverQuotes.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    wallId: uuid('wall_id')
      .notNull()
      .references(() => walls.id, { onDelete: 'restrict' }),
    slotId: uuid('slot_id')
      .notNull()
      .references(() => slots.id, { onDelete: 'restrict' }),
    targetPlacementId: uuid('target_placement_id')
      .notNull()
      .references(() => placements.id, { onDelete: 'restrict' }),
    pricingConfigId: uuid('pricing_config_id')
      .notNull()
      .references(() => pricingConfigVersions.id, { onDelete: 'restrict' }),
    currency: varchar('currency', { length: 3 }).notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    idempotencyKeyHash: varchar('idempotency_key_hash', {
      length: 64,
    }).notNull(),
    status: takeoverReservationStatus().notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    expiredAt: timestamp('expired_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('takeover_reservations_quote_uidx').on(table.quoteId),
    uniqueIndex('takeover_reservations_user_key_uidx').on(
      table.userId,
      table.idempotencyKeyHash,
    ),
    uniqueIndex('takeover_reservations_one_active_slot_uidx')
      .on(table.slotId)
      .where(sql`${table.status} = 'active'`),
    index('takeover_reservations_user_created_idx').on(
      table.userId,
      table.createdAt,
    ),
    check('takeover_reservations_currency_rub', sql`${table.currency} = 'RUB'`),
    check(
      'takeover_reservations_amount_valid',
      sql`${table.amountMinor} BETWEEN 1 AND 100000000000`,
    ),
    check(
      'takeover_reservations_hash_valid',
      sql`${table.idempotencyKeyHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'takeover_reservations_expiry_valid',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      'takeover_reservations_state_valid',
      sql`(${table.status}::text = 'consumed' AND ${table.consumedAt} IS NOT NULL AND ${table.cancelledAt} IS NULL AND ${table.expiredAt} IS NULL) OR (${table.status} = 'active' AND ${table.consumedAt} IS NULL AND ${table.cancelledAt} IS NULL AND ${table.expiredAt} IS NULL) OR (${table.status} = 'cancelled' AND ${table.consumedAt} IS NULL AND ${table.cancelledAt} IS NOT NULL AND ${table.expiredAt} IS NULL AND ${table.cancelledAt} >= ${table.createdAt}) OR (${table.status} = 'expired' AND ${table.consumedAt} IS NULL AND ${table.expiredAt} IS NOT NULL AND ${table.cancelledAt} IS NULL AND ${table.expiredAt} >= ${table.createdAt})`,
    ),
  ],
);

export const paymentState = pgEnum('payment_state', [
  'created',
  'provider_pending',
  'unknown',
  'succeeded',
  'canceled',
  'paid_but_not_fulfilled',
  'fulfilled',
]);
export const paymentOrders = pgTable(
  'payment_orders',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => takeoverReservations.id),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => takeoverQuotes.id),
    wallId: uuid('wall_id')
      .notNull()
      .references(() => walls.id),
    slotId: uuid('slot_id')
      .notNull()
      .references(() => slots.id),
    targetPlacementId: uuid('target_placement_id')
      .notNull()
      .references(() => placements.id),
    autographId: uuid('autograph_id')
      .notNull()
      .references(() => autographs.id),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    pricingConfigId: uuid('pricing_config_id')
      .notNull()
      .references(() => pricingConfigVersions.id),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    creatorShareBps: integer('creator_share_bps').notNull(),
    offerVersion: varchar('offer_version', { length: 64 }),
    offerHash: varchar('offer_hash', { length: 64 }),
    contentRulesVersion: varchar('content_rules_version', { length: 64 }),
    contentRulesHash: varchar('content_rules_hash', { length: 64 }),
    refundPolicyVersion: varchar('refund_policy_version', { length: 64 }),
    refundPolicyHash: varchar('refund_policy_hash', { length: 64 }),
    status: paymentState('status').notNull().default('created'),
    placementId: uuid('placement_id').references(() => placements.id),
    fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'payment_orders_legal_snapshot',
      sql`(${t.offerVersion} IS NULL AND ${t.offerHash} IS NULL AND ${t.contentRulesVersion} IS NULL AND ${t.contentRulesHash} IS NULL AND ${t.refundPolicyVersion} IS NULL AND ${t.refundPolicyHash} IS NULL) OR (${t.offerVersion} IS NOT NULL AND ${t.offerHash} IS NOT NULL AND ${t.contentRulesVersion} IS NOT NULL AND ${t.contentRulesHash} IS NOT NULL AND ${t.refundPolicyVersion} IS NOT NULL AND ${t.refundPolicyHash} IS NOT NULL AND ${t.offerVersion} ~ '^[a-zA-Z0-9._-]{1,64}$' AND ${t.contentRulesVersion} ~ '^[a-zA-Z0-9._-]{1,64}$' AND ${t.refundPolicyVersion} ~ '^[a-zA-Z0-9._-]{1,64}$' AND ${t.offerHash} ~ '^[a-f0-9]{64}$' AND ${t.contentRulesHash} ~ '^[a-f0-9]{64}$' AND ${t.refundPolicyHash} ~ '^[a-f0-9]{64}$')`,
    ),
    uniqueIndex('payment_orders_reservation_uidx').on(t.reservationId),
    uniqueIndex('payment_orders_placement_uidx').on(t.placementId),
    check(
      'payment_orders_amount',
      sql`${t.amountMinor} BETWEEN 1 AND 100000000000 AND ${t.currency} = 'RUB' AND ${t.creatorShareBps} BETWEEN 0 AND 10000`,
    ),
    check(
      'payment_orders_fulfillment',
      sql`(${t.status} = 'fulfilled' AND ${t.placementId} IS NOT NULL AND ${t.fulfilledAt} IS NOT NULL) OR (${t.status} <> 'fulfilled' AND ${t.placementId} IS NULL AND ${t.fulfilledAt} IS NULL)`,
    ),
  ],
);
export const checkoutConfirmations = pgTable(
  'checkout_confirmations',
  {
    orderId: uuid('order_id')
      .primaryKey()
      .references(() => paymentOrders.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => takeoverReservations.id, { onDelete: 'restrict' }),
    autographId: uuid('autograph_id')
      .notNull()
      .references(() => autographs.id, { onDelete: 'restrict' }),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    guaranteedVisibilitySeconds: integer(
      'guaranteed_visibility_seconds',
    ).notNull(),
    reservationExpiresAt: timestamp('reservation_expires_at', {
      withTimezone: true,
    }).notNull(),
    targetPlacementId: uuid('target_placement_id')
      .notNull()
      .references(() => placements.id, { onDelete: 'restrict' }),
    pricingConfigId: uuid('pricing_config_id')
      .notNull()
      .references(() => pricingConfigVersions.id, { onDelete: 'restrict' }),
    offerVersion: varchar('offer_version', { length: 64 }).notNull(),
    offerHash: varchar('offer_hash', { length: 64 }).notNull(),
    contentRulesVersion: varchar('content_rules_version', {
      length: 64,
    }).notNull(),
    contentRulesHash: varchar('content_rules_hash', { length: 64 }).notNull(),
    refundPolicyVersion: varchar('refund_policy_version', {
      length: 64,
    }).notNull(),
    refundPolicyHash: varchar('refund_policy_hash', { length: 64 }).notNull(),
    source: varchar('source', { length: 64 }).notNull().default('web'),
    context: varchar('context', { length: 64 })
      .notNull()
      .default('paid_checkout'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    check(
      'checkout_confirmation_semantics',
      sql`${t.source}='web' AND ${t.context}='paid_checkout' AND ${t.guaranteedVisibilitySeconds}>=0 AND ${t.amountMinor} BETWEEN 1 AND 100000000000 AND ${t.currency}='RUB'`,
    ),
    check(
      'checkout_confirmation_identity',
      sql`${t.offerVersion} ~ '^[a-zA-Z0-9._-]{1,64}$' AND ${t.contentRulesVersion} ~ '^[a-zA-Z0-9._-]{1,64}$' AND ${t.refundPolicyVersion} ~ '^[a-zA-Z0-9._-]{1,64}$' AND ${t.offerHash} ~ '^[a-f0-9]{64}$' AND ${t.contentRulesHash} ~ '^[a-f0-9]{64}$' AND ${t.refundPolicyHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => paymentOrders.id),
    provider: text('provider').notNull(),
    shopId: text('shop_id').notNull(),
    mode: text('mode').notNull(),
    providerPaymentId: text('provider_payment_id'),
    operationKey: uuid('operation_key').notNull(),
    requestFingerprint: varchar('request_fingerprint', {
      length: 64,
    }).notNull(),
    returnUrl: text('return_url').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    status: paymentState('status').notNull().default('created'),
    rawStatus: varchar('raw_status', { length: 256 }),
    confirmationUrl: text('confirmation_url'),
    reason: text('reason'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    leaseToken: uuid('lease_token'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    nextCheckAt: timestamp('next_check_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    failures: integer('failures').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('payments_order_uidx').on(t.orderId),
    uniqueIndex('payments_provider_uidx').on(t.provider, t.providerPaymentId),
    uniqueIndex('payments_operation_uidx').on(t.operationKey),
    index('payments_reconcile_idx').on(t.nextCheckAt),
    check(
      'payments_config',
      sql`${t.provider} = 'yookassa' AND ${t.mode} IN ('sandbox','live')`,
    ),
    check(
      'payments_amount',
      sql`${t.amountMinor} BETWEEN 1 AND 100000000000 AND ${t.currency} = 'RUB'`,
    ),
    check(
      'payments_fingerprint',
      sql`${t.requestFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'payments_verified',
      sql`${t.status} NOT IN ('succeeded','fulfilled','paid_but_not_fulfilled') OR (${t.verifiedAt} IS NOT NULL AND ${t.providerPaymentId} IS NOT NULL)`,
    ),
  ],
);
export const paymentEventReceipts = pgTable(
  'payment_event_receipts',
  {
    id: id(),
    provider: text('provider').notNull(),
    providerPaymentId: text('provider_payment_id').notNull(),
    event: text('event').notNull(),
    receivedAt: createdAt(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    result: text('result'),
  },
  (t) => [
    uniqueIndex('payment_event_receipts_identity').on(
      t.provider,
      t.providerPaymentId,
      t.event,
    ),
  ],
);
export const creatorEarnings = pgTable(
  'creator_earnings',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => paymentOrders.id),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id),
    placementId: uuid('placement_id')
      .notNull()
      .references(() => placements.id),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    grossAmountMinor: bigint('gross_amount_minor', {
      mode: 'bigint',
    }).notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    shareBps: integer('share_bps').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('creator_earnings_order_uidx').on(t.orderId),
    uniqueIndex('creator_earnings_payment_uidx').on(t.paymentId),
    uniqueIndex('creator_earnings_placement_uidx').on(t.placementId),
    check(
      'creator_earnings_amount',
      sql`${t.currency} = 'RUB' AND ${t.shareBps} BETWEEN 0 AND 10000 AND ${t.grossAmountMinor} BETWEEN 1 AND 100000000000 AND ${t.amountMinor} = (${t.grossAmountMinor} * ${t.shareBps}) / 10000`,
    ),
  ],
);

export const ageDeclarations = pgTable(
  'age_declarations',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'restrict' }),
    minimumAge: integer('minimum_age').notNull().default(18),
    declaredAt: timestamp('declared_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    source: varchar('source', { length: 64 }).notNull().default('web'),
    context: varchar('context', { length: 64 }).notNull().default('first_use'),
  },
  (t) => [
    check(
      'age_declaration_semantics',
      sql`${t.minimumAge} = 18 AND ${t.source} = 'web' AND ${t.context} = 'first_use'`,
    ),
  ],
);

// Private tombstones survive reservation removal and unknown S3 write outcomes.
// Keys are never reused. Reconciliation keeps deleting them on a bounded cadence.
export const originalUploadTombstones = pgTable(
  'original_upload_tombstones',
  {
    storageKey: text('storage_key').primaryKey(),
    nextCheckAt: timestamp('next_check_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [
    index('original_upload_tombstones_next_idx').on(table.nextCheckAt),
  ],
);

// Fixed-size global permits; the immutable key is also an exclusive resource fence.
export const autographStorageLeases = pgTable(
  'autograph_storage_leases',
  {
    slot: integer('slot').primaryKey(),
    operationId: uuid('operation_id').notNull().unique(),
    storageKey: text('storage_key').notNull().unique(),
    kind: text('kind').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      'autograph_storage_leases_slot',
      sql`(${table.kind} IN ('upload', 'complete') AND ${table.slot} BETWEEN 1 AND 4) OR (${table.kind} = 'cleanup' AND ${table.slot} = 5)`,
    ),
    check(
      'autograph_storage_leases_key',
      sql`length(btrim(${table.storageKey})) > 0`,
    ),
  ],
);

// At most one immutable output per processing attempt (existing maximum: three).
// Retain unadopted keys for late/unknown writes instead of deleting their evidence.
export const autographProcessingArtifacts = pgTable(
  'autograph_processing_artifacts',
  {
    leaseToken: uuid('lease_token').primaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => autographProcessingJobs.id, { onDelete: 'restrict' }),
    storageKey: text('storage_key').notNull().unique(),
    leaseExpiresAt: timestamp('lease_expires_at', {
      withTimezone: true,
    }).notNull(),
    nextCheckAt: timestamp('next_check_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    adoptedAt: timestamp('adopted_at', { withTimezone: true }),
  },
  (table) => [
    index('autograph_processing_artifacts_due_idx').on(table.nextCheckAt),
    check(
      'autograph_processing_artifacts_state',
      sql`${table.retiredAt} IS NULL OR ${table.adoptedAt} IS NULL`,
    ),
  ],
);

// One durable round-robin cursor. It advances with a claim, including claims
// whose external deletion subsequently fails or whose process exits.
export const autographCleanupSchedule = pgTable(
  'autograph_cleanup_schedule',
  {
    id: integer('id').primaryKey(),
    nextSource: integer('next_source').notNull().default(0),
  },
  (table) => [
    check('autograph_cleanup_schedule_singleton', sql`${table.id} = 1`),
    check(
      'autograph_cleanup_schedule_source',
      sql`${table.nextSource} BETWEEN 0 AND 2`,
    ),
  ],
);
