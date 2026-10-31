import { randomUUID } from 'node:crypto';
import { buildApi } from '../../apps/api/src/app';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { SessionService } from '../../packages/auth/src/index';
import {
  createPgSessionRepository,
  createDatabase,
  migrate,
} from '../../packages/db/src/index';
import { registerAccountWorkspace } from '../../apps/api/src/account-workspace';
import { scram, sqlScript } from '../../deploy/manual-deploy.mjs';
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  new URL(url).pathname !== '/autograph_test' ||
  !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)
)
  throw Error('Isolated local DB required');
const control = createDatabase(url);
const name = 'account_' + randomUUID().replaceAll('-', '');
const isolatedUrl = new URL(url);
isolatedUrl.pathname = '/' + name;
const admin = createDatabase(isolatedUrl.href);
let created = false,
  rolesOwned = false;
const id = randomUUID(),
  other = randomUUID(),
  slug = 'account-' + randomUUID();
const runtimeUrl = new URL(isolatedUrl);
runtimeUrl.username = 'da_api';
runtimeUrl.password = 'synthetic-account-test-password-0123456789';
const db = createDatabase(runtimeUrl.href);
const sessions = new SessionService(createPgSessionRepository(db.pool), 3600);
const tokens: Record<string, string> = {};
const headers = (user: string) => ({
  cookie: `da_session=${tokens[user]}`,
  origin: 'http://127.0.0.1:3000',
});
const app = buildApi(db, sessions, {
  appEnvironment: 'test',
  sessionTtlSeconds: 3600,
  trustedWebOrigins: ['http://127.0.0.1:3000'],
});
registerAccountWorkspace(app, db);
beforeAll(async () => {
  expect(
    (
      await control.pool.query(
        "SELECT rolname FROM pg_roles WHERE rolname IN ('da_api','da_worker','da_migrator')",
      )
    ).rows,
  ).toHaveLength(0);
  await control.pool.query(`CREATE DATABASE ${name}`);
  created = true;
  await migrate(admin.db, { migrationsFolder: 'packages/db/drizzle' });
  await admin.pool.query(`INSERT INTO users(id) VALUES ($1),($2)`, [id, other]);
  await admin.pool.query(
    `INSERT INTO autographs(user_id,source) VALUES ($1,'canvas'),($2,'photo')`,
    [id, other],
  );
  const passwords = [
    runtimeUrl.password,
    'synthetic-worker-test-password-0123456789',
    'synthetic-migration-test-password-0123456789',
  ];
  await admin.pool.query(
    passwords
      .map(
        (p, i) =>
          `SET destka.${['api', 'worker', 'migrator'][i]}_scram='${scram(p)}';`,
      )
      .join('\n') + sqlScript('deploy', 'postgres-bootstrap.sql'),
  );
  rolesOwned = true;
  await admin.pool.query(sqlScript('deploy', 'postgres-runtime.sql'));
  tokens[id] = (await sessions.createSession(id)).token;
  tokens[other] = (await sessions.createSession(other)).token;
});
afterAll(async () => {
  await app.close();
  await db.close();
  await admin.close();
  if (created) await control.pool.query(`DROP DATABASE ${name} WITH (FORCE)`);
  if (rolesOwned)
    await control.pool.query('DROP ROLE da_api,da_worker,da_migrator');
  await control.close();
});
it('denies anonymous access and lists only the authenticated owner, with no private keys', async () => {
  expect((await app.inject('/me/workspace')).statusCode).toBe(401);
  const r = await app.inject({
    url: '/me/workspace',
    headers: headers(id),
  });
  expect(r.statusCode).toBe(200);
  expect(r.headers['cache-control']).toBe('no-store');
  expect(r.json().autographs).toHaveLength(1);
  expect(r.json().autographs[0].source).toBe('canvas');
  expect(r.body).not.toMatch(/storage_key|secret_hash|provider_user_id/);
});
it('serializes concurrent profile creation with restricted credentials; collisions roll back', async () => {
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      app.inject({
        method: 'PUT',
        url: '/me/profile',
        headers: headers(id),
        payload: { displayName: 'My studio', slug },
      }),
    ),
  );
  expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200]);
  expect(
    (
      await admin.pool.query(
        'SELECT count(*)::int AS n FROM creators WHERE owner_user_id=$1',
        [id],
      )
    ).rows[0].n,
  ).toBe(1);
  const duplicate = await app.inject({
    method: 'PUT',
    url: '/me/profile',
    headers: headers(other),
    payload: { displayName: 'Other', slug },
  });
  expect(duplicate.statusCode).toBe(409);
  expect(
    (
      await admin.pool.query(
        'SELECT count(*)::int AS n FROM creators WHERE owner_user_id=$1',
        [other],
      )
    ).rows[0].n,
  ).toBe(0);
  const result = await app.inject({
    url: '/me/workspace',
    headers: headers(other),
  });
  expect(result.json().profile).toBeNull();
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/me/profile',
        headers: headers(id),
        payload: { displayName: 'x', slug, userId: other },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await db.pool.query(
        "SELECT rolsuper,has_database_privilege(current_user,current_database(),'CREATE') AS ddl FROM pg_roles WHERE rolname=current_user",
      )
    ).rows[0],
  ).toEqual({ rolsuper: false, ddl: false });
});
it('updates the display name on the server and exposes only owned Walls', async () => {
  const r = await app.inject({
    method: 'PUT',
    url: '/me/profile',
    headers: headers(id),
    payload: { displayName: 'New name', slug },
  });
  expect(r.statusCode).toBe(200);
  const summary = await app.inject({
    url: '/me/workspace',
    headers: headers(id),
  });
  expect(summary.json().profile.displayName).toBe('New name');
  expect(summary.json().walls).toEqual([]);
  expect(summary.json().canModerate).toBe(false);
});
it('never returns another owner’s private draft Wall', async () => {
  const p = await app.inject({
    method: 'PUT',
    url: '/me/profile',
    headers: headers(other),
    payload: { displayName: 'Other creator', slug: 'other-' + slug },
  });
  expect(p.statusCode).toBe(200);
  const ownCreator = (
    await admin.pool.query('SELECT id FROM creators WHERE owner_user_id=$1', [
      id,
    ])
  ).rows[0].id;
  const own = (
    await admin.pool.query(
      'INSERT INTO walls(creator_id,slot_count) VALUES ($1,3) RETURNING id',
      [ownCreator],
    )
  ).rows[0].id;
  const foreign = (
    await admin.pool.query(
      'INSERT INTO walls(creator_id,slot_count) VALUES ($1,7) RETURNING id',
      [p.json().id],
    )
  ).rows[0].id;
  const result = await app.inject({
    url: '/me/workspace',
    headers: headers(id),
  });
  expect(result.json().walls.map((w: { id: string }) => w.id)).toEqual([own]);
  expect(result.body).not.toContain(foreign);
});
