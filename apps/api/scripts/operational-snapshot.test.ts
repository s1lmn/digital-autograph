import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  collectOperationalSnapshot,
  evaluateOperationalAlerts,
} from './operational-snapshot';
import { decodeOperationalState } from '../../../packages/db/src/operational-snapshot';

const healthy = {
  connections: 2,
  connectionLimit: 30,
  sameRoleQueriesOver30Seconds: 0,
  processingReady: 0,
  processingOldestReadySeconds: 0,
  processingFailedLast15Minutes: 0,
  processingInFlight: 0,
  processingClaimsPastMaxLease: 0,
  processingOldestClaimSeconds: 0,
  paidNotFulfilled: 0,
  reconciliationOverdue5Minutes: 0,
  awaitingModeration: 0,
  moderationOldestSeconds: 0,
  originalUploadsReserved: 0,
  originalUploadsExpired: 0,
  originalUploadsOldestExpiredSeconds: 0,
  retiredUploadKeys: 0,
  retiredUploadKeysDue: 0,
  retiredUploadOldestDueSeconds: 0,
};

describe('operator snapshot and alert privacy', () => {
  it('returns a critical exit status and fixed alerts on real connection failures', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', resolve('apps/api/scripts/operational-snapshot.ts')],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 15000,
        env: {
          ...process.env,
          OPS_DATABASE_URL:
            'postgres://local_only:private-password@127.0.0.1:1/unreachable',
          OPS_S3_REGION: 'us-east-1',
          OPS_S3_BUCKET: 'private-test-bucket',
          OPS_S3_ENDPOINT: 'http://127.0.0.1:1',
          OPS_S3_ACCESS_KEY_ID: 'private-test-key',
          OPS_S3_SECRET_ACCESS_KEY: 'private-test-secret',
          OPS_RELEASE_SHA: 'a'.repeat(40),
        },
      },
    );
    expect(result.status).toBe(2);
    const output = JSON.parse(result.stdout);
    expect(output.alerts).toEqual([
      { code: 'DATABASE_UNAVAILABLE', severity: 'critical' },
      { code: 'STORAGE_UNAVAILABLE', severity: 'critical' },
    ]);
    expect(output.database).toBeNull();
    for (const value of [
      'private-password',
      'private-test-bucket',
      'private-test-key',
      'private-test-secret',
      'unreachable',
    ])
      expect(result.stdout + result.stderr).not.toContain(value);
  }, 20000);
  it('emits only aggregates and a validated release, not dependency error payloads', async () => {
    const secret = 'signed-private-object?token=secret-user-payment-identifier';
    const error = {
      get message() {
        throw new Error(secret);
      },
      toJSON() {
        return secret;
      },
    };
    const result = await collectOperationalSnapshot({
      readDatabase: async () => {
        throw error;
      },
      checkStorage: async () => {
        throw error;
      },
      release: 'a'.repeat(40),
      now: () => new Date('2026-10-16T00:00:00Z'),
    });
    expect(result).toEqual({
      version: 1,
      observedAt: '2026-10-16T00:00:00.000Z',
      release: 'a'.repeat(40),
      database: null,
      storageReachable: false,
      alerts: [
        { code: 'DATABASE_UNAVAILABLE', severity: 'critical' },
        { code: 'STORAGE_UNAVAILABLE', severity: 'critical' },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('keeps a healthy dependency visible when the other fails', async () => {
    const result = await collectOperationalSnapshot({
      readDatabase: async () => healthy,
      checkStorage: async () => {
        throw new Error('private bucket');
      },
    });
    expect(result.database).toEqual(healthy);
    expect(result.alerts).toEqual([
      { code: 'STORAGE_UNAVAILABLE', severity: 'critical' },
    ]);
  });

  it('does not claim a missing release or healthy state on failure', async () => {
    const result = await collectOperationalSnapshot({
      readDatabase: async () => healthy,
      checkStorage: async () => {},
    });
    expect(result.release).toBeNull();
    expect(result.alerts).toEqual([]);
  });

  it.each(['main', 'v1?secret', 'A'.repeat(40), 'b'.repeat(41), ''])(
    'rejects arbitrary release labels before I/O: %s',
    async (release) => {
      let calls = 0;
      await expect(
        collectOperationalSnapshot({
          release,
          readDatabase: async () => {
            calls++;
            return healthy;
          },
          checkStorage: async () => {
            calls++;
          },
        }),
      ).rejects.toThrow();
      expect(calls).toBe(0);
    },
  );

  it('alerts on even one paid but unfulfilled order, independently of warning thresholds', () => {
    expect(
      evaluateOperationalAlerts({ ...healthy, paidNotFulfilled: 1 }, true),
    ).toEqual([{ code: 'PAID_NOT_FULFILLED', severity: 'critical' }]);
  });

  it('honors warning boundaries and does not consider a small young queue a failure', () => {
    expect(
      evaluateOperationalAlerts(
        {
          ...healthy,
          connections: 23,
          processingReady: 20,
          processingOldestReadySeconds: 299,
          moderationOldestSeconds: 3599,
        },
        true,
      ),
    ).toEqual([]);
    expect(
      evaluateOperationalAlerts(
        {
          ...healthy,
          connections: 24,
          sameRoleQueriesOver30Seconds: 1,
          processingOldestReadySeconds: 300,
          processingFailedLast15Minutes: 1,
          reconciliationOverdue5Minutes: 1,
          moderationOldestSeconds: 3600,
        },
        true,
      ).map((a) => a.code),
    ).toEqual([
      'DATABASE_CONNECTION_PRESSURE',
      'LONG_RUNNING_QUERIES',
      'PROCESSING_BACKLOG',
      'PROCESSING_FAILURES',
      'RECONCILIATION_OVERDUE',
      'MODERATION_BACKLOG',
    ]);
  });

  it.each<[number, number, string[]]>([
    [299, 0, []],
    [300, 0, ['ORIGINAL_UPLOAD_CAPACITY_EXHAUSTED']],
    [299, 9700, []],
    [299, 9701, ['ORIGINAL_UPLOAD_KEY_BUDGET_EXHAUSTED']],
    [
      300,
      9700,
      [
        'ORIGINAL_UPLOAD_CAPACITY_EXHAUSTED',
        'ORIGINAL_UPLOAD_KEY_BUDGET_EXHAUSTED',
      ],
    ],
    [0, 10000, ['ORIGINAL_UPLOAD_KEY_BUDGET_EXHAUSTED']],
    [0, 10001, ['ORIGINAL_UPLOAD_KEY_BUDGET_EXHAUSTED']],
  ])(
    'signals persisted admission caps at %i reservations and %i retired keys',
    (reserved, retired, codes) => {
      expect(
        evaluateOperationalAlerts(
          {
            ...healthy,
            originalUploadsReserved: reserved,
            retiredUploadKeys: retired,
          },
          true,
        ),
      ).toEqual(codes.map((code) => ({ code, severity: 'critical' })));
    },
  );

  it('observes cleanup ages without inventing a grace, retention or SLA policy', () => {
    expect(
      evaluateOperationalAlerts(
        {
          ...healthy,
          originalUploadsReserved: 2,
          originalUploadsExpired: 1,
          originalUploadsOldestExpiredSeconds: 86401,
          retiredUploadKeys: 3,
          retiredUploadKeysDue: 1,
          retiredUploadOldestDueSeconds: 3601,
        },
        true,
      ),
    ).toEqual([]);
  });

  it('warns on even one claim past the supported maximum, without calling in-flight work a failure', () => {
    const processing = {
      ...healthy,
      processingInFlight: 2,
      processingOldestClaimSeconds: 400,
    };
    expect(evaluateOperationalAlerts(processing, true)).toEqual([]);
    expect(
      evaluateOperationalAlerts(
        { ...processing, processingClaimsPastMaxLease: 1 },
        true,
      ),
    ).toEqual([
      { code: 'PROCESSING_CLAIMS_PAST_MAX_LEASE', severity: 'warning' },
    ]);
    expect(
      evaluateOperationalAlerts(
        { ...processing, processingClaimsPastMaxLease: 1, paidNotFulfilled: 1 },
        true,
      ),
    ).toContainEqual({ code: 'PAID_NOT_FULFILLED', severity: 'critical' });
  });

  it('projects only numeric fields and rejects corrupt/overflow/noninteger aggregates', () => {
    const row = Object.fromEntries(
      Object.entries(healthy).map(([k, v]) => [k, String(v)]),
    );
    expect(
      decodeOperationalState({ ...row, credentials: 'must not escape' }),
    ).toEqual(healthy);
    for (const invalid of [
      '-1',
      '1.5',
      'Infinity',
      '9007199254740992',
      null,
      1,
      undefined,
    ]) {
      expect(() =>
        decodeOperationalState({ ...row, connections: invalid }),
      ).toThrow('Invalid operational aggregate');
    }
    expect(() =>
      decodeOperationalState({ ...row, connectionLimit: '0' }),
    ).toThrow();
    for (const field of [
      'processingInFlight',
      'processingClaimsPastMaxLease',
      'processingOldestClaimSeconds',
      'originalUploadsReserved',
      'originalUploadsExpired',
      'originalUploadsOldestExpiredSeconds',
      'retiredUploadKeys',
      'retiredUploadKeysDue',
      'retiredUploadOldestDueSeconds',
    ]) {
      expect(() =>
        decodeOperationalState({ ...row, [field]: undefined }),
      ).toThrow('Invalid operational aggregate');
      expect(() =>
        decodeOperationalState({ ...row, [field]: '9007199254740992' }),
      ).toThrow('Invalid operational aggregate');
    }
  });
});
