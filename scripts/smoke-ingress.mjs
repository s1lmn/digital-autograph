// Isolated synthetic ingress smoke. No cloud, application DB, secrets or deploy.
import assert from 'node:assert/strict';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const image = 'caddy:2.10.2-alpine';
const id = `destka-ingress-${randomUUID()}`;
const fixture = `${id}-upstream`;
const proxy = `${id}-proxy`;
const directory = mkdtempSync(join(tmpdir(), 'destka-ingress-'));
const limit = 10 * 1024 * 1024;
let port;
function docker(...args) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 120_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
function request({
  host = 'api.ingress.test',
  path = '/upload',
  bytes,
  chunked = false,
  headers = {},
  stall = false,
} = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: bytes ? 'PUT' : 'GET',
        headers: {
          Host: host,
          ...headers,
          ...(bytes && !chunked ? { 'Content-Length': bytes.length } : {}),
          ...(chunked ? { 'Transfer-Encoding': 'chunked' } : {}),
        },
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (part) => {
          body += part;
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            body,
            elapsed: Date.now() - start,
          }),
        );
        response.on('error', reject);
      },
    );
    req.on('error', (error) => {
      if (stall) resolve({ error: error.code, elapsed: Date.now() - start });
      else reject(error);
    });
    req.setTimeout(55_000, () =>
      req.destroy(new Error('Smoke request exceeded deadline')),
    );
    if (stall) {
      req.flushHeaders();
      req.write('x');
    } else if (chunked && bytes) {
      const write = () => {
        while (offset < bytes.length) {
          const part = bytes.subarray(offset, offset + 64 * 1024);
          offset += part.length;
          if (!req.write(part)) {
            req.once('drain', write);
            return;
          }
        }
        req.end();
      };
      let offset = 0;
      write();
    } else req.end(bytes);
  });
}
try {
  const domains = JSON.parse(
    docker(
      'run',
      '--rm',
      '--network',
      'none',
      '--mount',
      `type=bind,source=${resolve('deploy/Caddyfile.destka')},target=/etc/caddy/Caddyfile,readonly`,
      image,
      'caddy',
      'adapt',
      '--config',
      '/etc/caddy/Caddyfile',
      '--adapter',
      'caddyfile',
    ),
  );
  const domainConfig = JSON.stringify(domains);
  assert(domainConfig.includes('www.destka.ru'));
  assert(domainConfig.includes('https://destka.ru{http.request.uri}'));
  assert(domainConfig.includes('301'));
  // Fixture consumes streams without buffering, and counts only complete bodies.
  writeFileSync(
    join(directory, 'fixture.mjs'),
    `
    import http from 'node:http';
    let completed = 0;
    for (const port of [3000, 4000]) http.createServer((req, res) => {
      if (req.url === '/stats') { res.end(String(completed)); return; }
      if (req.url === '/hang') return;
      let bytes = 0;
      req.on('data', chunk => bytes += chunk.length);
      req.on('error', () => {});
      req.on('end', () => { completed++; res.end(String(bytes)); });
    }).listen(port, '0.0.0.0');
  `,
  );
  writeFileSync(
    join(directory, 'Caddyfile'),
    readFileSync(resolve('deploy/Caddyfile')),
  );
  docker('network', 'create', id);
  docker(
    'run',
    '-d',
    '--name',
    fixture,
    '--network',
    id,
    '--network-alias',
    'api',
    '--network-alias',
    'web',
    '-v',
    `${directory}:/fixture:ro`,
    'node:24-alpine',
    'node',
    '/fixture/fixture.mjs',
  );
  docker(
    'run',
    '--rm',
    '--network',
    'none',
    '-v',
    `${directory}/Caddyfile:/etc/caddy/Caddyfile:ro`,
    '-e',
    'WEB_DOMAIN=http://web.ingress.test:8080',
    '-e',
    'API_DOMAIN=http://api.ingress.test:8080',
    image,
    'caddy',
    'validate',
    '--config',
    '/etc/caddy/Caddyfile',
    '--adapter',
    'caddyfile',
  );
  const adapted = JSON.parse(
    docker(
      'run',
      '--rm',
      '--network',
      'none',
      '-v',
      `${directory}/Caddyfile:/etc/caddy/Caddyfile:ro`,
      '-e',
      'WEB_DOMAIN=http://web.ingress.test:8080',
      '-e',
      'API_DOMAIN=http://api.ingress.test:8080',
      image,
      'caddy',
      'adapt',
      '--config',
      '/etc/caddy/Caddyfile',
      '--adapter',
      'caddyfile',
    ),
  );
  const servers = Object.values(adapted.apps.http.servers);
  assert(servers.length > 0);
  for (const server of servers) {
    assert.equal(server.read_header_timeout, 10_000_000_000);
    assert.equal(server.read_timeout, 35_000_000_000);
    assert.equal(server.write_timeout, 45_000_000_000);
    assert.equal(server.idle_timeout, 60_000_000_000);
    assert.equal(server.max_header_bytes, 32000);
  }
  docker(
    'run',
    '-d',
    '--name',
    proxy,
    '--network',
    id,
    '-p',
    '127.0.0.1::8080',
    '-v',
    `${directory}/Caddyfile:/etc/caddy/Caddyfile:ro`,
    '-e',
    'WEB_DOMAIN=http://web.ingress.test:8080',
    '-e',
    'API_DOMAIN=http://api.ingress.test:8080',
    image,
  );
  await delay(500);
  port = Number(docker('port', proxy, '8080/tcp').split(':').at(-1));
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await request({ path: '/stats' })).status === 200) {
        ready = true;
        break;
      }
    } catch {
      /* Starting. */
    }
    await delay(100);
  }
  assert(ready, 'Caddy must start with the checked-in configuration');
  for (const chunked of [false, true]) {
    const result = await request({ bytes: Buffer.alloc(limit, 1), chunked });
    assert.equal(result.status, 200);
    assert.equal(result.body, String(limit));
    const before = (await request({ path: '/stats' })).body;
    assert.equal(
      (await request({ bytes: Buffer.alloc(limit + 1, 1), chunked })).status,
      413,
    );
    assert.equal(
      (await request({ path: '/stats' })).body,
      before,
      'Oversized body must not complete upstream',
    );
  }
  assert.equal(
    (
      await request({
        host: 'web.ingress.test',
        bytes: Buffer.alloc(limit + 1),
      })
    ).status,
    413,
  );
  assert.equal(
    (await request({ headers: { 'X-Synthetic-Large': 'x'.repeat(40_000) } }))
      .status,
    431,
  );
  assert.equal((await request({ path: '/health/ready' })).status, 200);
  process.stdout.write(
    'PASS: config validation; exact 10 MiB fixed/chunked; +1 byte rejected; Web cap; header cap; health\n',
  );
  // Real configured deadlines, without replacing them with a faster test config.
  const completedBeforeTimeout = (await request({ path: '/stats' })).body;
  const [slowBody, stalledHeaders, hangingUpstream] = await Promise.all([
    request({ bytes: Buffer.alloc(100), chunked: true, stall: true }),
    new Promise((resolve, reject) => {
      const start = Date.now();
      const socket = net.connect(port, '127.0.0.1', () =>
        socket.write('PUT /upload HTTP/1.1\r\nHost: api.ingress.test\r\n'),
      );
      socket.on('data', () => {});
      socket.on('error', reject);
      socket.on('close', () => resolve(Date.now() - start));
      socket.setTimeout(20_000, () =>
        socket.destroy(new Error('Header deadline not enforced')),
      );
    }),
    request({ path: '/hang' }),
  ]);
  process.stdout.write(
    JSON.stringify({ slowBody, stalledHeaders, hangingUpstream }) + '\n',
  );
  assert(slowBody.elapsed >= 30_000 && slowBody.elapsed < 50_000);
  // v2.10.2 may return an empty implicit 200 after a canceled read.
  // A status alone must never authorize completion/ownership in the application.
  assert.notEqual(slowBody.body, '100');
  assert.equal(
    (await request({ path: '/stats' })).body,
    completedBeforeTimeout,
    'Timed-out upload must not complete a body upstream',
  );
  assert(stalledHeaders >= 8_000 && stalledHeaders < 18_000);
  assert.equal(hangingUpstream.status, 504);
  assert(hangingUpstream.elapsed >= 35_000 && hangingUpstream.elapsed < 45_000);
  assert.equal((await request({ path: '/health/ready' })).status, 200);
  process.stdout.write(
    'PASS: real header/body/upstream deadlines; subsequent health request\n',
  );
} finally {
  for (const container of [proxy, fixture]) {
    try {
      docker('rm', '-f', container);
    } catch {
      /* May not have started. */
    }
  }
  try {
    docker('network', 'rm', id);
  } catch {
    /* May not have started. */
  }
  rmSync(directory, { recursive: true, force: true });
}
