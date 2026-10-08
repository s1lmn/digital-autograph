import {
  safeErrorDetails,
  safeErrorLogArguments,
} from '@digital-autograph/observability';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';

type LoggerOptions = Exclude<
  FastifyServerOptions['logger'],
  boolean | undefined
>;

export function apiLoggerOptions(stream?: {
  write(message: string): void;
}): LoggerOptions {
  return {
    ...(stream ? { stream } : {}),
    serializers: {
      err(error) {
        const safe = safeErrorDetails(error);
        // Fastify requires standard fields; contents are fixed markers.
        return {
          ...safe,
          type: safe.name,
          message: '[REDACTED]',
          stack: '[REDACTED]',
        };
      },
      req(request) {
        return {
          method: request.method,
          url: request.url?.split('?')[0],
          host: request.headers.host,
          remoteAddress: request.ip,
        };
      },
      res(reply) {
        return { statusCode: reply.statusCode };
      },
    },
    hooks: {
      logMethod(args, method) {
        method.apply(
          this,
          safeErrorLogArguments(args) as Parameters<typeof method>,
        );
      },
    },
    redact: {
      paths: ['req.headers.cookie', 'req.headers.authorization'],
      censor: '[REDACTED]',
    },
  };
}

export function registerSafeApiErrors(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    let status =
      reply.statusCode >= 400 && reply.statusCode <= 599
        ? reply.statusCode
        : 500;
    try {
      const value = error as { status?: unknown; statusCode?: unknown } | null;
      status =
        [value?.status, value?.statusCode, status].find(
          (value): value is number =>
            typeof value === 'number' &&
            Number.isInteger(value) &&
            value >= 400 &&
            value <= 599,
        ) ?? 500;
    } catch {
      status = 500;
    }
    // Provider $metadata is diagnostic only, never the public response status.
    if (status < 500) return reply.send(error);
    request.log.error(
      { err: error, event: 'API_REQUEST_FAILED' },
      'API request failed',
    );
    return reply.code(status).send({ error: { code: 'INTERNAL_ERROR' } });
  });
}
