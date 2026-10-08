import Fastify from 'fastify';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { apiLoggerOptions, registerSafeApiErrors } from './logging';
import { buildApi } from './app';

const secret = 'synthetic-credential-S3-signed-query';

describe('real API logging and exception boundary', () => {
  it('redacts actual Pino output, including default message and interpolation paths', async () => {
    let output = '';
    const app = Fastify({
      logger: apiLoggerOptions({
        write: (line) => {
          output += line;
        },
      }),
    });
    registerSafeApiErrors(app);
    const error = Object.assign(
      new Error(secret, { cause: new Error(secret) }),
      { code: 'ECONNRESET', credential: secret },
    );
    app.get('/failure', async () => {
      throw error;
    });
    try {
      app.log.error(error);
      app.log.error({
        name: 'Error',
        message: secret,
        stack: secret,
        credential: secret,
      });
      app.log.error(runInNewContext('new Error(secret)', { secret }));
      app.log.error({ err: error, body: secret, msg: secret }, '%s', secret);
      const response = await app.inject({
        url: `/failure?code=${secret}`,
        headers: { authorization: secret, cookie: `token=${secret}` },
      });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: { code: 'INTERNAL_ERROR' } });
      expect(output).not.toContain(secret);
      const lines = output
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const failure = lines.find((line) => line.event === 'API_REQUEST_FAILED');
      expect(failure).toMatchObject({
        level: 50,
        err: { name: 'Error', code: 'ECONNRESET' },
        msg: 'Application error',
      });
      expect(failure.reqId).toBeTruthy();
      expect(lines.find((line) => line.res)?.res).toEqual({ statusCode: 500 });
      expect(lines.find((line) => line.req)?.req.url).toBe('/failure');
    } finally {
      await app.close();
    }
  });

  it('preserves handled auth and client failure contracts in buildApi', async () => {
    const app = buildApi(
      { checkConnection: async () => {} },
      {
        validateSession: async () => {
          throw new Error(secret);
        },
        revokeSession: async () => {},
        revokeAllUserSessions: async () => {},
      },
      {
        appEnvironment: 'test',
        sessionTtlSeconds: 1209600,
        trustedWebOrigins: ['http://127.0.0.1:3000'],
      },
    );
    app.get('/client-failure', async () => {
      throw Object.assign(new Error('safe client validation'), {
        statusCode: 422,
      });
    });
    app.get('/unavailable', async () => {
      throw Object.assign(new Error(secret), { statusCode: 503 });
    });
    app.get('/provider-failure', async () => {
      throw Object.assign(new Error(secret), {
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403 },
      });
    });
    app.get('/legacy-status', async () => {
      throw Object.assign(new Error(secret), { status: 502, statusCode: 503 });
    });
    try {
      expect((await app.inject('/auth/me')).json()).toEqual({
        error: { code: 'UNAUTHENTICATED' },
      });
      const failure = await app.inject({
        url: '/auth/me',
        headers: { cookie: 'da_session=synthetic' },
      });
      expect(failure.statusCode).toBe(500);
      expect(failure.json()).toEqual({ error: { code: 'INTERNAL_ERROR' } });
      const client = await app.inject('/client-failure');
      expect(client.statusCode).toBe(422);
      expect(client.json().message).toBe('safe client validation');
      const unavailable = await app.inject('/unavailable');
      expect(unavailable.statusCode).toBe(503);
      expect(unavailable.body).not.toContain(secret);
      const provider = await app.inject('/provider-failure');
      expect(provider.statusCode).toBe(500);
      expect(provider.json()).toEqual({ error: { code: 'INTERNAL_ERROR' } });
      const legacy = await app.inject('/legacy-status');
      expect(legacy.statusCode).toBe(502);
      expect(legacy.json()).toEqual({ error: { code: 'INTERNAL_ERROR' } });
    } finally {
      await app.close();
    }
  });
});
