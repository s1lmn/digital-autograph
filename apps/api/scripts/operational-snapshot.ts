import { pathToFileURL } from 'node:url';
import {
  autographResourceLimits,
  createOperationalReader,
  type OperationalDatabaseState,
} from '@digital-autograph/db';
import {
  createPrivateS3Storage,
  type PrivateS3Config,
} from '@digital-autograph/integrations/private-s3';

type Alert = { code: string; severity: 'critical' | 'warning' };
export type OperationalSnapshot = {
  version: 1;
  observedAt: string;
  release: string | null;
  database: OperationalDatabaseState | null;
  storageReachable: boolean;
  alerts: Alert[];
};

export function evaluateOperationalAlerts(
  database: OperationalDatabaseState | null,
  storageReachable: boolean,
): Alert[] {
  const alerts: Alert[] = [];
  const add = (
    condition: boolean,
    code: string,
    severity: Alert['severity'],
  ) => {
    if (condition) alerts.push({ code, severity });
  };
  add(database === null, 'DATABASE_UNAVAILABLE', 'critical');
  add(!storageReachable, 'STORAGE_UNAVAILABLE', 'critical');
  if (!database) return alerts;
  add(database.paidNotFulfilled > 0, 'PAID_NOT_FULFILLED', 'critical');
  add(
    database.originalUploadsReserved >= autographResourceLimits.globalPending,
    'ORIGINAL_UPLOAD_CAPACITY_EXHAUSTED',
    'critical',
  );
  add(
    database.originalUploadsReserved + database.retiredUploadKeys >=
      autographResourceLimits.retiredKeyBudget,
    'ORIGINAL_UPLOAD_KEY_BUDGET_EXHAUSTED',
    'critical',
  );
  add(
    database.connections / database.connectionLimit >= 0.8,
    'DATABASE_CONNECTION_PRESSURE',
    'warning',
  );
  add(
    database.sameRoleQueriesOver30Seconds > 0,
    'LONG_RUNNING_QUERIES',
    'warning',
  );
  add(
    database.processingOldestReadySeconds >= 300,
    'PROCESSING_BACKLOG',
    'warning',
  );
  add(
    database.processingFailedLast15Minutes > 0,
    'PROCESSING_FAILURES',
    'warning',
  );
  add(
    database.processingClaimsPastMaxLease > 0,
    'PROCESSING_CLAIMS_PAST_MAX_LEASE',
    'warning',
  );
  add(
    database.reconciliationOverdue5Minutes > 0,
    'RECONCILIATION_OVERDUE',
    'warning',
  );
  add(
    database.moderationOldestSeconds >= 3600,
    'MODERATION_BACKLOG',
    'warning',
  );
  return alerts;
}

export async function collectOperationalSnapshot(input: {
  readDatabase: () => Promise<OperationalDatabaseState>;
  checkStorage: () => Promise<void>;
  release?: string;
  now?: () => Date;
}): Promise<OperationalSnapshot> {
  // A release label cannot become an arbitrary user/credential label.
  if (input.release !== undefined && !/^[a-f0-9]{40}$/.test(input.release)) {
    throw new Error('OPS_RELEASE_SHA must be a full lowercase commit SHA');
  }
  const [db, storage] = await Promise.allSettled([
    input.readDatabase(),
    input.checkStorage(),
  ]);
  const database = db.status === 'fulfilled' ? db.value : null;
  const storageReachable = storage.status === 'fulfilled';
  return {
    version: 1,
    observedAt: (input.now?.() ?? new Date()).toISOString(),
    release: input.release ?? null,
    database,
    storageReachable,
    alerts: evaluateOperationalAlerts(database, storageReachable),
  };
}

function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name];
  if (!value) throw new Error('Missing operator configuration');
  return value;
}

export async function runOperationalSnapshot(env: NodeJS.ProcessEnv) {
  // Explicit operator configuration, separate from application startup.
  const databaseUrl = required(env, 'OPS_DATABASE_URL');
  const parsed = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol))
    throw new Error('Invalid operator database');
  const config: PrivateS3Config = {
    region: required(env, 'OPS_S3_REGION'),
    bucket: required(env, 'OPS_S3_BUCKET'),
    ...(env.OPS_S3_ENDPOINT && { endpoint: env.OPS_S3_ENDPOINT }),
    ...(env.OPS_S3_ACCESS_KEY_ID && { accessKeyId: env.OPS_S3_ACCESS_KEY_ID }),
    ...(env.OPS_S3_SECRET_ACCESS_KEY && {
      secretAccessKey: env.OPS_S3_SECRET_ACCESS_KEY,
    }),
  };
  if (Boolean(config.accessKeyId) !== Boolean(config.secretAccessKey))
    throw new Error('Incomplete storage credentials');
  if (config.endpoint) {
    const endpoint = new URL(config.endpoint);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(
      endpoint.hostname,
    );
    if (
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      (endpoint.protocol !== 'https:' &&
        !(local && endpoint.protocol === 'http:'))
    ) {
      throw new Error('Invalid operator storage endpoint');
    }
  }
  if (
    env.OPS_RELEASE_SHA !== undefined &&
    !/^[a-f0-9]{40}$/.test(env.OPS_RELEASE_SHA)
  )
    throw new Error('Invalid release');
  const reader = createOperationalReader(databaseUrl);
  const storage = createPrivateS3Storage(config);
  try {
    const snapshot = await collectOperationalSnapshot({
      readDatabase: () => reader.read(),
      checkStorage: () => storage.checkConnection(AbortSignal.timeout(5000)),
      ...(env.OPS_RELEASE_SHA && { release: env.OPS_RELEASE_SHA }),
    });
    process.stdout.write(`${JSON.stringify(snapshot)}\n`);
    return snapshot.alerts.some((a) => a.severity === 'critical')
      ? 2
      : snapshot.alerts.length
        ? 3
        : 0;
  } finally {
    storage.close();
    await reader.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runOperationalSnapshot(process.env)
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.stderr.write('{"event":"OPS_SNAPSHOT_FAILED"}\n');
      process.exitCode = 1;
    });
}
