import { safeErrorDetails } from '@digital-autograph/observability';

const definitions = {
  WORKER_POLL_FAILED: [50, 'Worker polling cycle failed'],
  NOTIFICATION_POLL_FAILED: [50, 'Notification polling cycle failed'],
  OAUTH_ATTEMPT_CLEANUP_FAILED: [50, 'OAuth attempt cleanup failed'],
  AUTOGRAPH_PARTIAL_CLEANUP_FAILED: [
    40,
    'Partial cleaned object cleanup failed',
  ],
  AUTOGRAPH_FAILURE_RECORD_FAILED: [
    50,
    'Autograph job failure could not be recorded',
  ],
  AUTOGRAPH_PROCESSING_FAILED: [40, 'Autograph processing attempt failed'],
} as const;

const reasons = new Set([
  'INVALID_IMAGE',
  'UNSUPPORTED_IMAGE_FORMAT',
  'IMAGE_TOO_LARGE',
  'IMAGE_DIMENSIONS_EXCEEDED',
  'EMPTY_AUTOGRAPH',
  'STORAGE_FAILURE',
  'PROCESSING_FAILURE',
]);

export function workerFailureRecord(
  event: keyof typeof definitions,
  error: unknown,
  context?: { jobId?: unknown; reason?: unknown },
) {
  const [level, msg] = definitions[event];
  const record: {
    level: number;
    time: string;
    runtime: 'worker';
    event: string;
    msg: string;
    err: ReturnType<typeof safeErrorDetails>;
    jobId?: string;
    reason?: string;
  } = {
    level,
    time: new Date().toISOString(),
    runtime: 'worker',
    event,
    msg,
    err: safeErrorDetails(error),
  };
  // Context is internal, but bound it too; never serialize arbitrary job data.
  try {
    const jobId = context?.jobId;
    if (
      typeof jobId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        jobId,
      )
    )
      record.jobId = jobId;
    const reason = context?.reason;
    if (typeof reason === 'string' && reasons.has(reason))
      record.reason = reason;
  } catch {
    // Diagnostic enrichment must not change worker recovery or shutdown.
  }
  return record;
}
