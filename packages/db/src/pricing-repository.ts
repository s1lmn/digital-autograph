import type {
  PricingConfiguration,
  WallStatus,
} from '@digital-autograph/domain';
import {
  PricingError,
  type PersistedQuote,
  type PricingRepository,
  type QuoteContext,
  type QuoteInput,
} from '@digital-autograph/walls';
import type { Pool, PoolClient } from 'pg';

type ConfigRow = {
  id: string;
  algorithm_version: 'takeover_ladder_v1';
  currency: 'RUB';
  base_amount_minor: string;
  minimum_amount_minor: string;
  maximum_amount_minor: string;
  dynamic_takeover_limit: number;
  takeover_step_size: number;
  step_amount_minor: string;
  decay_interval_seconds: number;
  decay_amount_minor: string;
  decay_floor_amount_minor: string;
  guaranteed_visibility_seconds: number;
};

function configFromRow(row: ConfigRow): PricingConfiguration & { id: string } {
  return {
    id: row.id,
    algorithmVersion: row.algorithm_version,
    currency: row.currency,
    baseAmountMinor: BigInt(row.base_amount_minor),
    minimumAmountMinor: BigInt(row.minimum_amount_minor),
    maximumAmountMinor: BigInt(row.maximum_amount_minor),
    dynamicTakeoverLimit: row.dynamic_takeover_limit,
    takeoverStepSize: row.takeover_step_size,
    stepAmountMinor: BigInt(row.step_amount_minor),
    decayIntervalSeconds: row.decay_interval_seconds,
    decayAmountMinor: BigInt(row.decay_amount_minor),
    decayFloorAmountMinor: BigInt(row.decay_floor_amount_minor),
    guaranteedVisibilitySeconds: row.guaranteed_visibility_seconds,
  };
}

async function transaction<T>(
  pool: Pool,
  run: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await run(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function requireAdmin(client: PoolClient, userId: string): Promise<void> {
  const found = await client.query(
    `SELECT 1 FROM users u
     JOIN user_roles ur ON ur.user_id = u.id AND ur.role = 'admin'
     WHERE u.id = $1::uuid AND u.status = 'active'`,
    [userId],
  );
  if (!found.rowCount) throw new PricingError('FORBIDDEN');
}

const configSelect = `SELECT id, algorithm_version, currency,
  base_amount_minor, minimum_amount_minor, maximum_amount_minor,
  dynamic_takeover_limit, takeover_step_size, step_amount_minor,
  decay_interval_seconds, decay_amount_minor, decay_floor_amount_minor,
  guaranteed_visibility_seconds
  FROM pricing_config_versions`;

async function quoteInTransaction(
  client: PoolClient,
  input: QuoteInput,
  ttlSeconds: number,
  calculate: Parameters<PricingRepository['createQuote']>[2],
): Promise<PersistedQuote> {
  // Match Free Claim's Wall -> Slot lock order. Shared locks let independent
  // quotes coexist, while lifecycle and Placement completion must serialize.
  const wall = await client.query<{
    status: WallStatus;
    start_at: Date | null;
    end_at: Date | null;
    pricing_config_id: string | null;
  }>(
    `SELECT status, start_at, end_at, pricing_config_id
     FROM walls WHERE id = $1::uuid FOR SHARE`,
    [input.wallId],
  );
  const currentWall = wall.rows[0];
  if (!currentWall) throw new PricingError('WALL_NOT_FOUND');
  const slot = await client.query<{ wall_id: string }>(
    'SELECT wall_id FROM slots WHERE id = $1::uuid FOR SHARE',
    [input.slotId],
  );
  if (!slot.rows[0]) throw new PricingError('SLOT_NOT_FOUND');
  if (slot.rows[0].wall_id !== input.wallId) {
    throw new PricingError('SLOT_NOT_IN_WALL');
  }
  const target = await client.query<{
    id: string;
    user_id: string;
    started_at: Date;
  }>(
    `SELECT id, user_id, started_at FROM placements
     WHERE slot_id = $1::uuid AND ended_at IS NULL FOR SHARE`,
    [input.slotId],
  );
  const pricing = currentWall.pricing_config_id
    ? await client.query<ConfigRow>(`${configSelect} WHERE id = $1::uuid`, [
        currentWall.pricing_config_id,
      ])
    : null;
  if (currentWall.pricing_config_id && !pricing?.rows[0]) {
    throw new PricingError('INVALID_PRICING_STATE');
  }
  // One read snapshot for the Wall-wide paid takeover count and last activity;
  // sample the PostgreSQL clock after all row-lock waits.
  const activity = await client.query<{
    takeover_count: string;
    last_takeover_at: Date | null;
    now: Date;
  }>(
    `SELECT count(*) AS takeover_count, max(p.started_at) AS last_takeover_at,
            clock_timestamp() AS now
     FROM placements p JOIN slots s ON s.id = p.slot_id
     WHERE s.wall_id = $1::uuid AND p.source = 'takeover'`,
    [input.wallId],
  );
  const snapshot = activity.rows[0];
  if (!snapshot) throw new Error('PostgreSQL pricing snapshot unavailable');
  const config = pricing?.rows[0] ? configFromRow(pricing.rows[0]) : null;
  const context: QuoteContext = {
    wall: {
      status: currentWall.status,
      startAt: currentWall.start_at,
      endAt: currentWall.end_at,
    },
    pricing: config,
    targetPlacement: target.rows[0]
      ? {
          id: target.rows[0].id,
          userId: target.rows[0].user_id,
          startedAt: target.rows[0].started_at,
        }
      : null,
    wallTakeoverCount: BigInt(snapshot.takeover_count),
    lastTakeoverAt: snapshot.last_takeover_at,
    now: snapshot.now,
  };
  const calculation = calculate(context);
  if (!config || !context.targetPlacement) {
    throw new Error('Pricing callback accepted incomplete quote context');
  }
  const expiresAt = new Date(snapshot.now.getTime() + ttlSeconds * 1000);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO takeover_quotes
       (user_id, wall_id, slot_id, target_placement_id, pricing_config_id,
        algorithm_version, currency, amount_minor, wall_takeover_count,
        last_takeover_at, step_index, ladder_amount_minor,
        decay_intervals_applied, quoted_at, expires_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
             $6, $7, $8::bigint, $9::bigint, $10::timestamptz,
             $11::bigint, $12::bigint, $13::bigint,
             $14::timestamptz, $15::timestamptz)
     RETURNING id`,
    [
      input.userId,
      input.wallId,
      input.slotId,
      context.targetPlacement.id,
      config.id,
      config.algorithmVersion,
      config.currency,
      calculation.amountMinor.toString(),
      context.wallTakeoverCount.toString(),
      context.lastTakeoverAt,
      calculation.stepIndex.toString(),
      calculation.ladderAmountMinor.toString(),
      calculation.decayIntervalsApplied.toString(),
      snapshot.now,
      expiresAt,
    ],
  );
  const id = inserted.rows[0]?.id;
  if (!id) throw new Error('Quote insertion returned no ID');
  return {
    ...input,
    id,
    targetPlacementId: context.targetPlacement.id,
    pricingConfigId: config.id,
    algorithmVersion: config.algorithmVersion,
    currency: config.currency,
    amountMinor: calculation.amountMinor,
    wallTakeoverCount: context.wallTakeoverCount,
    lastTakeoverAt: context.lastTakeoverAt,
    stepIndex: calculation.stepIndex,
    ladderAmountMinor: calculation.ladderAmountMinor,
    decayIntervalsApplied: calculation.decayIntervalsApplied,
    baseAmountMinor: config.baseAmountMinor,
    quotedAt: snapshot.now,
    expiresAt,
  };
}

export function createPgPricingRepository(pool: Pool): PricingRepository {
  return {
    async createConfig(actorUserId, config, activateForNewWalls) {
      return transaction(pool, async (client) => {
        await requireAdmin(client, actorUserId);
        const result = await client.query<{ id: string; created_at: Date }>(
          `INSERT INTO pricing_config_versions
             (algorithm_version, currency, base_amount_minor,
              minimum_amount_minor, maximum_amount_minor,
              dynamic_takeover_limit, takeover_step_size, step_amount_minor,
              decay_interval_seconds, decay_amount_minor,
              decay_floor_amount_minor, guaranteed_visibility_seconds,
              created_by_user_id)
           VALUES ($1, $2, $3::bigint, $4::bigint, $5::bigint,
                   $6::integer, $7::integer, $8::bigint, $9::integer,
                   $10::bigint, $11::bigint, $12::integer, $13::uuid)
           RETURNING id, created_at`,
          [
            config.algorithmVersion,
            config.currency,
            config.baseAmountMinor.toString(),
            config.minimumAmountMinor.toString(),
            config.maximumAmountMinor.toString(),
            config.dynamicTakeoverLimit,
            config.takeoverStepSize,
            config.stepAmountMinor.toString(),
            config.decayIntervalSeconds,
            config.decayAmountMinor.toString(),
            config.decayFloorAmountMinor.toString(),
            config.guaranteedVisibilitySeconds,
            actorUserId,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new Error('Pricing config insertion returned no row');
        if (activateForNewWalls) {
          await client.query(
            `INSERT INTO platform_pricing_default
               (singleton_id, pricing_config_id)
             VALUES (1, $1::uuid)
             ON CONFLICT (singleton_id) DO UPDATE
             SET pricing_config_id = EXCLUDED.pricing_config_id,
                 updated_at = clock_timestamp()`,
            [row.id],
          );
        }
        return {
          id: row.id,
          createdAt: row.created_at,
          activeForNewWalls: activateForNewWalls,
        };
      });
    },

    async assignWallConfig(actorUserId, wallId, pricingConfigId) {
      return transaction(pool, async (client) => {
        await requireAdmin(client, actorUserId);
        const wall = await client.query<{ pricing_config_id: string | null }>(
          'SELECT pricing_config_id FROM walls WHERE id = $1::uuid FOR UPDATE',
          [wallId],
        );
        if (!wall.rows[0]) throw new PricingError('WALL_NOT_FOUND');
        if (wall.rows[0].pricing_config_id !== null) {
          throw new PricingError('WALL_PRICING_ALREADY_SET');
        }
        const config = await client.query(
          'SELECT 1 FROM pricing_config_versions WHERE id = $1::uuid',
          [pricingConfigId],
        );
        if (!config.rowCount)
          throw new PricingError('PRICING_CONFIG_NOT_FOUND');
        const priorQuotes = await client.query(
          'SELECT 1 FROM takeover_quotes WHERE wall_id = $1::uuid LIMIT 1',
          [wallId],
        );
        if (priorQuotes.rowCount) {
          throw new PricingError('WALL_PRICING_ALREADY_SET');
        }
        await client.query(
          'UPDATE walls SET pricing_config_id = $2::uuid WHERE id = $1::uuid',
          [wallId, pricingConfigId],
        );
        return { wallId, pricingConfigId };
      });
    },

    async createQuote(input, ttlSeconds, calculate) {
      return transaction(pool, (client) =>
        quoteInTransaction(client, input, ttlSeconds, calculate),
      );
    },
  };
}
