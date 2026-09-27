import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';
import { URL } from 'node:url';

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Could not reserve a local port');
  }
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

const port = await availablePort();
const api = spawn(process.execPath, ['apps/api/dist/main.js'], {
  env: { ...process.env, API_HOST: '127.0.0.1', API_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
api.stdout.resume();
api.stderr.resume();

try {
  let live = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (api.exitCode !== null)
      throw new Error('Built API exited during startup');
    try {
      const response = await globalThis.fetch(
        `http://127.0.0.1:${port}/health/live`,
        {
          signal: globalThis.AbortSignal.timeout(500),
        },
      );
      if (response.status === 200) {
        live = true;
        break;
      }
    } catch {
      // Startup may not have bound its port yet.
    }
    await delay(100);
  }
  if (!live) throw new Error('Built API did not become live');

  const start = await globalThis.fetch(
    `http://127.0.0.1:${port}/auth/google/start`,
    {
      redirect: 'manual',
      signal: globalThis.AbortSignal.timeout(3000),
    },
  );
  const location = new URL(start.headers.get('location') ?? '');
  const cookie = start.headers.get('set-cookie') ?? '';
  if (
    start.status !== 302 ||
    location.hostname !== 'accounts.google.com' ||
    !location.searchParams.get('state') ||
    !location.searchParams.get('nonce') ||
    !cookie.includes('HttpOnly')
  ) {
    throw new Error('Built API did not start Google login correctly');
  }
  process.stdout.write('Built API live and Google start smoke passed\n');
} finally {
  api.kill('SIGTERM');
  await new Promise((resolve) => {
    if (api.exitCode !== null) return resolve();
    const timeout = setTimeout(() => api.kill('SIGKILL'), 3000);
    timeout.unref();
    api.once('close', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}
