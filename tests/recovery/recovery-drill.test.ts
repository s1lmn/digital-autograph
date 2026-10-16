import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { expect, it } from 'vitest';
import { runPrivateStorageRecoveryDrill } from '../../packages/integrations/src/recovery-storage';

it('dumps and restores the actual schema and synthetic financial history in disposable PostgreSQL', () => {
  const result = spawnSync(
    process.execPath,
    [resolve('scripts/smoke-recovery-drill.mjs')],
    { encoding: 'utf8', timeout: 180000 },
  );
  // Failure output is fixed/redacted by the tool; never attach database archives.
  expect(result.status, result.stderr).toBe(0);
  const evidence = JSON.parse(result.stdout.trim());
  expect(evidence).toMatchObject({
    event: 'SYNTHETIC_RECOVERY_DRILL_PASS',
    financialChains: 1,
    sourceUnchanged: true,
    restoredConstraintsChecked: true,
    legalSnapshotChecked: existsSync(
      resolve('packages/db/drizzle/0017_legal_evidence.sql'),
    ),
    checkoutConfirmationChecked: existsSync(
      resolve('packages/db/drizzle/0019_checkout_confirmation.sql'),
    ),
    productionRestore: false,
  });
  expect(evidence.archiveBytes).toBeGreaterThan(100);
}, 190000);

it('backs up and restores synthetic bytes through private source/backup/restore buckets', async () => {
  const { APP_ENV, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } =
    process.env;
  if (!APP_ENV || !S3_ENDPOINT || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY)
    throw new Error('Isolated test storage configuration required');
  const result = await runPrivateStorageRecoveryDrill({
    environment: APP_ENV,
    endpoint: S3_ENDPOINT,
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
  });
  expect(result).toMatchObject({
    objectBytes: 96,
    sha256Verified: true,
    unsignedReadDenied: true,
    productionRestore: false,
  });
  expect(JSON.stringify(result)).not.toMatch(
    /recovery-(source|backup|restore)-/,
  );
}, 90000);
