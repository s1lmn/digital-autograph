import { Agent, createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { PrivateObjectTooLargeError } from '@digital-autograph/autographs';
import { createPrivateS3Storage } from './private-s3';
import { readPrivateObject } from './private-object-read';
import { privateObjectOperation } from './private-object-operation';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(
  reply: (path: string, response: ServerResponse) => void,
) {
  const server = createServer((request, response) => {
    reply(new URL(request.url!, 'http://127.0.0.1').pathname, response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Loopback fixture required');
  const config = {
    endpoint: `http://127.0.0.1:${address.port}`,
    bucket: 'private-test-bucket',
    region: 'us-east-1',
    accessKeyId: 'local_test_only',
    secretAccessKey: 'local_test_only',
  };
  const storage = createPrivateS3Storage(config);
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  const client = new S3Client({
    ...config,
    credentials: config,
    forcePathStyle: true,
    maxAttempts: 1,
    requestHandler: { httpAgent: agent },
  });
  cleanups.push(async () => {
    storage.close();
    client.destroy();
    agent.destroy();
  });
  return {
    storage,
    client,
    read(key: string, maxBytes: number, timeoutMs = 2000) {
      return readPrivateObject(
        (signal) =>
          client.send(
            new GetObjectCommand({ Bucket: config.bucket, Key: key }),
            { abortSignal: signal },
          ),
        maxBytes,
        timeoutMs,
      );
    },
  };
}

describe('private S3 reads through the real HTTP SDK transport', () => {
  it('aborts a stalled mutation error body and recovers the same single socket', async () => {
    let close!: () => void;
    const closed = new Promise<void>((resolve) => {
      close = resolve;
    });
    const { client, read } = await fixture((path, response) => {
      if (path.endsWith('/stall')) {
        response.once('close', close);
        response.writeHead(500, { 'content-type': 'application/xml' });
        response.write('<Error><Code>InternalError</Code><Message>');
      } else response.end('ok');
    });
    await expect(
      privateObjectOperation(
        (signal) =>
          client.send(
            new PutObjectCommand({
              Bucket: 'private-test-bucket',
              Key: 'stall',
              Body: Buffer.from('test'),
              IfNoneMatch: '*',
            }),
            { abortSignal: signal },
          ),
        undefined,
        500,
      ),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
    await closed;
    expect(await read('ok', 2)).toEqual(Buffer.from('ok'));
  });
  it.each(['put', 'head', 'delete'] as const)(
    'aborts stalled %s transport and frees the single socket',
    async (kind) => {
      let close!: () => void;
      const closed = new Promise<void>((resolve) => {
        close = resolve;
      });
      const { client, read } = await fixture((path, response) => {
        if (path.endsWith('/stall')) response.once('close', close);
        else response.end('ok');
      });
      const input = { Bucket: 'private-test-bucket', Key: 'stall' };
      const pending = privateObjectOperation(
        (signal) => {
          const options = { abortSignal: signal };
          if (kind === 'put')
            return client.send(
              new PutObjectCommand({
                ...input,
                Body: Buffer.from('test'),
                IfNoneMatch: '*',
              }),
              options,
            );
          if (kind === 'head')
            return client.send(new HeadObjectCommand(input), options);
          return client.send(new DeleteObjectCommand(input), options);
        },
        undefined,
        500,
      );
      await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
      await closed;
      expect(await read('ok', 2)).toEqual(Buffer.from('ok'));
    },
  );
  it.each(['headers', 'body'])(
    'aborts stalled %s and frees the only socket for the next read',
    async (phase) => {
      let requested = false;
      let ended!: () => void;
      const closed = new Promise<void>((resolve) => {
        ended = resolve;
      });
      const { read } = await fixture((path, response) => {
        if (path.endsWith('/stall')) {
          requested = true;
          response.once('close', ended);
          if (phase === 'body') {
            response.writeHead(200, {
              'content-type': 'application/octet-stream',
            });
            response.write(Buffer.from('partial'));
          }
        } else response.end(Buffer.from('ok'));
      });
      await expect(read('stall', 100)).rejects.toMatchObject({
        name: 'TimeoutError',
      });
      expect(requested).toBe(true);
      await closed;
      expect(await read('ok', 2)).toEqual(Buffer.from('ok'));
    },
  );

  it('keeps actual-byte limits with the production adapter and recovers after overflow', async () => {
    const maximum = 10 * 1024 * 1024;
    const expected = Buffer.alloc(maximum, 7);
    const { storage } = await fixture((path, response) => {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      if (path.endsWith('/overflow')) {
        response.write(expected);
        response.end(Buffer.from([1]));
      } else response.end(expected);
    });
    expect(
      (await storage.getPrivateObject('exact', maximum)).equals(expected),
    ).toBe(true);
    await expect(
      storage.getPrivateObject('overflow', maximum),
    ).rejects.toBeInstanceOf(PrivateObjectTooLargeError);
    expect(
      (await storage.getPrivateObject('recovery', maximum)).equals(expected),
    ).toBe(true);
  });

  it('rejects truncated bodies and preserves a provider 404 without returning partial bytes', async () => {
    const { storage } = await fixture((path, response) => {
      if (path.endsWith('/truncated')) {
        response.writeHead(200, { 'content-length': 100, connection: 'close' });
        response.end('partial');
      } else {
        response.writeHead(404, { 'content-type': 'application/xml' });
        response.end(
          '<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>',
        );
      }
    });
    await expect(storage.getPrivateObject('truncated', 100)).rejects.toThrow();
    await expect(
      storage.getPrivateObject('missing', 100),
    ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
  });
});
