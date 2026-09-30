import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';
import { createDatabase } from '@digital-autograph/db';
import { createPrivateS3Storage } from '@digital-autograph/integrations';
import {
  e2eApprovalId,
  e2eAssetId,
  e2eAutographId,
  e2eCreatorId,
  e2eModeratorId,
  e2eSlotId,
  e2eStorageKey,
  e2eUserId,
  e2eWallId,
} from '../../../e2e/fixtures';

async function waitForService<T>(
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < 30) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
  throw new Error(`${name} did not become ready after 30 seconds`, {
    cause: lastError,
  });
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
if (process.env.APP_ENV !== 'test') {
  throw new Error('E2E setup requires APP_ENV=test');
}
const parsedDatabaseUrl = new URL(databaseUrl);
if (
  parsedDatabaseUrl.pathname !== '/autograph_e2e' ||
  !['localhost', '127.0.0.1'].includes(parsedDatabaseUrl.hostname) ||
  parsedDatabaseUrl.port !== '5434'
) {
  throw new Error('E2E setup may only reset the local autograph_e2e database');
}

const bucket = process.env.S3_BUCKET;
const endpoint = process.env.S3_ENDPOINT;
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
  throw new Error('E2E S3 configuration is incomplete');
}
const parsedEndpoint = new URL(endpoint);
if (
  bucket !== 'autographse2e' ||
  parsedEndpoint.protocol !== 'http:' ||
  !['localhost', '127.0.0.1'].includes(parsedEndpoint.hostname)
) {
  throw new Error(
    'E2E setup may only write to the local autographse2e MinIO bucket',
  );
}

const database = createDatabase(databaseUrl);
try {
  await waitForService('E2E PostgreSQL', () => database.checkConnection());
  await database.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
} finally {
  await database.close();
}

const migration = spawnSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['--filter', '@digital-autograph/db', 'db:migrate'],
  {
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
);
if (migration.error) throw migration.error;
if (migration.status !== 0) process.exit(migration.status ?? 1);

const storage = createPrivateS3Storage({
  endpoint,
  region: process.env.S3_REGION ?? 'us-east-1',
  bucket,
  accessKeyId,
  secretAccessKey,
});
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
  'base64',
);
try {
  await waitForService('E2E MinIO', async () => {
    await storage.bootstrapLocalBucket();
    await storage.putPrivateObject(e2eStorageKey, png);
  });
} finally {
  storage.close();
}

const seedDatabase = createDatabase(databaseUrl);
try {
  await seedDatabase.pool.query(
    `INSERT INTO users (id, status) VALUES
       ($1, 'active'), ($2, 'active')
     ON CONFLICT (id) DO NOTHING`,
    [e2eUserId, e2eModeratorId],
  );
  await seedDatabase.pool.query(
    `INSERT INTO user_roles (user_id, role) VALUES ($1, 'moderator')`,
    [e2eModeratorId],
  );
  await seedDatabase.pool.query(
    `INSERT INTO creators (id, owner_user_id) VALUES ($1, $2)`,
    [e2eCreatorId, e2eModeratorId],
  );
  await seedDatabase.pool.query(
    `INSERT INTO creator_profiles (creator_id, slug, display_name)
     VALUES ($1, 'e2e-creator', 'E2E Creator')`,
    [e2eCreatorId],
  );
  await seedDatabase.pool.query(
    `INSERT INTO walls (id, creator_id, status, slot_count)
     VALUES ($1, $2, 'live', 1)`,
    [e2eWallId, e2eCreatorId],
  );
  await seedDatabase.pool.query(
    `INSERT INTO slots (id, wall_id, position) VALUES ($1, $2, 0)`,
    [e2eSlotId, e2eWallId],
  );
  await seedDatabase.pool.query(
    `INSERT INTO autographs (id, user_id, source, status)
     VALUES ($1, $2, 'canvas', 'ready')`,
    [e2eAutographId, e2eUserId],
  );
  await seedDatabase.pool.query(
    `INSERT INTO autograph_assets (
       id, autograph_id, role, status, storage_key, verified_size_bytes,
       actual_content_type, width, height, uploaded_at
     ) VALUES ($1, $2, 'cleaned', 'uploaded', $3, $4, 'image/png', 1, 1, now())`,
    [e2eAssetId, e2eAutographId, e2eStorageKey, png.length],
  );
  await seedDatabase.pool.query(
    `INSERT INTO autograph_user_approvals
       (id, autograph_id, user_id, cleaned_asset_id)
     VALUES ($1, $2, $3, $4)`,
    [e2eApprovalId, e2eAutographId, e2eUserId, e2eAssetId],
  );
  await seedDatabase.pool.query(
    `INSERT INTO autograph_moderation_decisions (
       autograph_id, moderator_user_id, user_approval_id, cleaned_asset_id,
       decision
     ) VALUES ($1, $2, $3, $4, 'approved')`,
    [e2eAutographId, e2eModeratorId, e2eApprovalId, e2eAssetId],
  );
} finally {
  await seedDatabase.close();
}

console.log('Migrated and seeded the isolated E2E database.');
