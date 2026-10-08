const names = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'URIError',
  'EvalError',
  'AggregateError',
  'AbortError',
  'TimeoutError',
  'DatabaseError',
  'AccessDenied',
  'NoSuchKey',
  'NoSuchBucket',
  'InvalidAccessKeyId',
  'SignatureDoesNotMatch',
  'UnknownError',
]);
const codes = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ENOENT',
  'EACCES',
  'EPERM',
  'ENOSPC',
  'EADDRINUSE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_HAS_EXPIRED',
  '08000',
  '08003',
  '08006',
  '23502',
  '23503',
  '23505',
  '23514',
  '40001',
  '40P01',
  '42P01',
  '42501',
  '53300',
  '53400',
  '57014',
  '57P01',
  '57P02',
  '57P03',
]);
const events = new Set([
  'API_STARTUP_FAILED',
  'API_SHUTDOWN_FAILED',
  'API_REQUEST_FAILED',
]);

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

export type SafeError = { name: string; code?: string; statusCode?: number };

// Never enumerate error properties or inspect message, stack, cause or toJSON.
export function safeErrorDetails(error: unknown): SafeError {
  try {
    const value = record(error);
    if (!value) return { name: 'UnknownError' };
    const name = value.name;
    const result: SafeError = {
      name: typeof name === 'string' && names.has(name) ? name : 'UnknownError',
    };
    const code = value.code;
    if (typeof code === 'string' && codes.has(code)) result.code = code;
    const status = [
      value.status,
      value.statusCode,
      record(value.$metadata)?.httpStatusCode,
    ].find(
      (value) =>
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 100 &&
        value <= 599,
    );
    if (
      typeof status === 'number' &&
      Number.isInteger(status) &&
      status >= 100 &&
      status <= 599
    ) {
      result.statusCode = status;
    }
    return result;
  } catch {
    // Even hostile getters/proxies must not break failure reporting.
    return { name: 'UnknownError' };
  }
}

// Pino otherwise copies error.message into msg even with a custom err serializer.
export function safeErrorLogArguments(args: readonly unknown[]): unknown[] {
  try {
    const first = args[0];
    const object = record(first);
    const directError =
      first instanceof Error ||
      (object && ('message' in object || 'stack' in object));
    if (!directError && (!object || !('err' in object))) return [...args];
    const output: Record<string, unknown> = {
      err: safeErrorDetails(directError ? first : object?.err),
    };
    if (!directError && object) {
      // These values still pass through the API's bounded req/res serializers.
      if (object.req) output.req = object.req;
      if (object.res) output.res = object.res;
      if (typeof object.event === 'string' && events.has(object.event))
        output.event = object.event;
    }
    return [output, 'Application error'];
  } catch {
    return [{ err: { name: 'UnknownError' } }, 'Application error'];
  }
}

export function runtimeFailureRecord(
  runtime: 'api' | 'worker',
  error: unknown,
) {
  return {
    level: 50,
    time: new Date().toISOString(),
    runtime,
    event: 'STARTUP_FAILED',
    err: safeErrorDetails(error),
    msg: 'Runtime startup failed',
  };
}
