import { Agent, createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrivateObjectTooLargeError } from '@digital-autograph/autographs';
import { createPrivateS3Storage } from './private-s3';
import { readPrivateObject } from './private-object-read';

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
