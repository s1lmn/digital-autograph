import { createHash } from 'node:crypto';
import {
  SessionCreationNotAllowedError,
  SessionService,
} from '../../packages/auth/src/index';
import { buildApi } from '../../apps/api/src/app';
import {
  setSessionCookie,
  type AuthHttpConfig,
} from '../../apps/api/src/auth/http';
import {
  createDatabase,
  createPgSessionRepository,
  eq,
} from '../../packages/db/src/index';
import { sessions, userRoles, users } from '../../packages/db/src/schema';
import { userFixture } from './fixtures';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (
  !testDatabaseUrl ||
  new URL(testDatabaseUrl).pathname !== '/autograph_test'
) {
  throw new Error(
    'Auth integration tests require the isolated autograph_test database',
  );
}

const database = createDatabase(testDatabaseUrl);
const repository = createPgSessionRepository(database.pool);
const service = new SessionService(repository, 1209600);
const localConfig: AuthHttpConfig = {
  appEnvironment: 'test',
  sessionTtlSeconds: 1209600,
  trustedWebOrigins: ['http://127.0.0.1:3000'],
};

function required<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) throw new Error('Expected one database row');
  return row;
}

async function createUser(number: number) {
  return required(
    await database.db.insert(users).values(userFixture(number)).returning(),
  );
}

async function expireSession(sessionId: string): Promise<void> {
  await database.pool.query(
    "UPDATE sessions SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE id = $1",
    [sessionId],
  );
}

function cookie(token: string): string {
  return `da_session=${token}`;
}

describe('Auth Core with PostgreSQL', () => {
  beforeAll(async () => database.checkConnection());
  beforeEach(async () => {
    await database.pool.query('TRUNCATE TABLE users CASCADE');
  });
  afterAll(async () => database.close());

  it('creates and validates a 256-bit opaque session without storing the raw token', async () => {
    const user = await createUser(1);
    const issued = await service.createSession(user.id);
    expect(issued.token).toMatch(/^da_s1_[A-Za-z0-9_-]{43}$/);
    const stored = await database.pool.query<{ secret_hash: string }>(
      'SELECT secret_hash FROM sessions WHERE id = $1',
      [issued.sessionId],
    );
    const hash = required(stored.rows).secret_hash;
    expect(hash).toBe(createHash('sha256').update(issued.token).digest('hex'));
    expect(hash).not.toContain(issued.token);
    const persisted = required(
      await database.db
        .select()
        .from(sessions)
        .where(eq(sessions.id, issued.sessionId)),
    );
    expect(persisted.expiresAt.getTime() - persisted.createdAt.getTime()).toBe(
      1_209_600_000,
    );
    expect(await service.validateSession(issued.token)).toMatchObject({
      sessionId: issued.sessionId,
      user: { id: user.id, status: 'active' },
    });
    expect(await service.validateSession('malformed')).toBeNull();
    expect(await service.validateSession(`da_s1_${'A'.repeat(43)}`)).toBeNull();
  });

  it('rejects expired, revoked, disabled, and anonymized users', async () => {
    const user = await createUser(1);
    const expired = await service.createSession(user.id);
    await expireSession(expired.sessionId);
    expect(await service.validateSession(expired.token)).toBeNull();
    expect(await service.rotateSession(expired.token)).toBeNull();

    const revoked = await service.createSession(user.id);
    await service.revokeSession(revoked.token);
    expect(await service.validateSession(revoked.token)).toBeNull();
    expect(await service.rotateSession(revoked.token)).toBeNull();

    const active = await service.createSession(user.id);
    await database.db
      .update(users)
      .set({ status: 'disabled' })
      .where(eq(users.id, user.id));
    expect(await service.validateSession(active.token)).toBeNull();
    await expect(service.createSession(user.id)).rejects.toBeInstanceOf(
      SessionCreationNotAllowedError,
    );
    await database.db
      .update(users)
      .set({ status: 'anonymized' })
      .where(eq(users.id, user.id));
    expect(await service.validateSession(active.token)).toBeNull();
    await expect(service.createSession(user.id)).rejects.toBeInstanceOf(
      SessionCreationNotAllowedError,
    );
  });

  it('rotates atomically and leaves exactly one valid successor', async () => {
    const user = await createUser(1);
    const old = await service.createSession(user.id);
    const next = await service.rotateSession(old.token);
    expect(next).not.toBeNull();
    if (!next) throw new Error('Expected rotated session');
    expect(next.token).not.toBe(old.token);
    expect(await service.validateSession(old.token)).toBeNull();
    expect(await service.validateSession(next.token)).toMatchObject({
      user: { id: user.id },
    });
    const rows = await database.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, user.id));
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.revokedAt === null)).toHaveLength(1);
  });

  it('allows only one of two concurrent rotations of the same credential', async () => {
    const user = await createUser(1);
    const old = await service.createSession(user.id);
    const results = await Promise.all([
      service.rotateSession(old.token),
      service.rotateSession(old.token),
    ]);
    const successors = results.filter((result) => result !== null);
    expect(successors).toHaveLength(1);
    expect(await service.validateSession(old.token)).toBeNull();
    const successor = successors[0];
    if (!successor) throw new Error('Expected one successor');
    expect(await service.validateSession(successor.token)).not.toBeNull();
    const active = await database.pool.query<{ count: string }>(
      'SELECT count(*) FROM sessions WHERE user_id = $1 AND revoked_at IS NULL',
      [user.id],
    );
    expect(required(active.rows).count).toBe('1');
  });

  it('makes logout-all win over any concurrent rotation of an existing session', async () => {
    const user = await createUser(1);
    const old = await service.createSession(user.id);
    const [successor] = await Promise.all([
      service.rotateSession(old.token),
      service.revokeAllUserSessions(user.id),
    ]);
    expect(await service.validateSession(old.token)).toBeNull();
    if (successor)
      expect(await service.validateSession(successor.token)).toBeNull();
  });

  it('revokes one or all sessions while preserving unrelated user sessions', async () => {
    const user = await createUser(1);
    const unrelated = await createUser(2);
    const first = await service.createSession(user.id);
    const second = await service.createSession(user.id);
    const third = await service.createSession(unrelated.id);
    await service.revokeSession(first.token);
    await service.revokeSession(first.token);
    expect(await service.validateSession(first.token)).toBeNull();
    expect(await service.validateSession(second.token)).not.toBeNull();
    await service.revokeAllUserSessions(user.id);
    expect(await service.validateSession(second.token)).toBeNull();
    expect(await service.validateSession(third.token)).not.toBeNull();
  });

  it('constrains administrative roles without requiring an ordinary user role', async () => {
    const user = await createUser(1);
    await database.db
      .insert(userRoles)
      .values({ userId: user.id, role: 'moderator' });
    await database.db
      .insert(userRoles)
      .values({ userId: user.id, role: 'finance' });
    const rows = await database.db
      .select()
      .from(userRoles)
      .where(eq(userRoles.userId, user.id));
    expect(rows.map((row) => row.role).sort()).toEqual([
      'finance',
      'moderator',
    ]);
    await expect(
      database.db
        .insert(userRoles)
        .values({ userId: user.id, role: 'moderator' }),
    ).rejects.toThrow();
    await expect(
      database.pool.query(
        "INSERT INTO user_roles (user_id, role) VALUES ($1, 'creator')",
        [user.id],
      ),
    ).rejects.toThrow();
  });

  it('serves /auth/me only for an active session and omits credentials', async () => {
    const user = await createUser(1);
    const issued = await service.createSession(user.id);
    const app = buildApi(database, service, localConfig);
    try {
      const anonymous = await app.inject('/auth/me');
      expect(anonymous.statusCode).toBe(401);
      expect(anonymous.json()).toEqual({ error: { code: 'UNAUTHENTICATED' } });
      const valid = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { cookie: cookie(issued.token) },
      });
      expect(valid.statusCode).toBe(200);
      expect(valid.json()).toEqual({ user: { id: user.id, status: 'active' } });
      expect(valid.body).not.toContain(issued.token);
      expect(valid.body).not.toContain('secret_hash');
      await service.revokeSession(issued.token);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/auth/me',
            headers: { cookie: cookie(issued.token) },
          })
        ).statusCode,
      ).toBe(401);
      const expired = await service.createSession(user.id);
      await expireSession(expired.sessionId);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/auth/me',
            headers: { cookie: cookie(expired.token) },
          })
        ).statusCode,
      ).toBe(401);
      const disabled = await service.createSession(user.id);
      await database.db
        .update(users)
        .set({ status: 'disabled' })
        .where(eq(users.id, user.id));
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/auth/me',
            headers: { cookie: cookie(disabled.token) },
          })
        ).statusCode,
      ).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('logs out idempotently, clears the cookie, and rejects the old session', async () => {
    const user = await createUser(1);
    const issued = await service.createSession(user.id);
    const app = buildApi(database, service, localConfig);
    try {
      const request = {
        method: 'POST' as const,
        url: '/auth/logout',
        headers: {
          cookie: cookie(issued.token),
          origin: 'http://127.0.0.1:3000',
        },
      };
      const first = await app.inject(request);
      expect(first.statusCode).toBe(204);
      expect(first.headers['set-cookie']).toContain('da_session=');
      expect(first.headers['set-cookie']).toContain('HttpOnly');
      expect(first.headers['set-cookie']).toContain('SameSite=Lax');
      expect(first.headers['set-cookie']).toContain('Path=/');
      expect(await service.validateSession(issued.token)).toBeNull();
      expect((await app.inject(request)).statusCode).toBe(204);
      expect(
        (await app.inject({ method: 'POST', url: '/auth/logout' })).statusCode,
      ).toBe(204);
    } finally {
      await app.close();
    }
  });

  it('logs out all current-user sessions, including the executing session', async () => {
    const user = await createUser(1);
    const other = await createUser(2);
    const current = await service.createSession(user.id);
    const sibling = await service.createSession(user.id);
    const unrelated = await service.createSession(other.id);
    const app = buildApi(database, service, localConfig);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/logout-all',
        headers: {
          cookie: cookie(current.token),
          origin: 'http://127.0.0.1:3000',
        },
      });
      expect(response.statusCode).toBe(204);
      expect(response.headers['set-cookie']).toContain('da_session=');
      expect(await service.validateSession(current.token)).toBeNull();
      expect(await service.validateSession(sibling.token)).toBeNull();
      expect(await service.validateSession(unrelated.token)).not.toBeNull();
      expect(
        (await app.inject({ method: 'POST', url: '/auth/logout-all' }))
          .statusCode,
      ).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('enforces origin checks and exact credentialed CORS', async () => {
    const user = await createUser(1);
    const issued = await service.createSession(user.id);
    const app = buildApi(database, service, localConfig);
    try {
      const blocked = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: {
          cookie: cookie(issued.token),
          origin: 'https://evil.example',
        },
      });
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json()).toEqual({ error: { code: 'INVALID_ORIGIN' } });
      expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
      expect(await service.validateSession(issued.token)).not.toBeNull();
      const missingOrigin = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: { cookie: cookie(issued.token) },
      });
      expect(missingOrigin.statusCode).toBe(403);
      const allowed = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: {
          cookie: cookie(issued.token),
          origin: 'http://127.0.0.1:3000',
        },
      });
      expect(allowed.statusCode).toBe(200);
      expect(allowed.headers['access-control-allow-origin']).toBe(
        'http://127.0.0.1:3000',
      );
      expect(allowed.headers['access-control-allow-credentials']).toBe('true');
      expect(allowed.headers['access-control-allow-origin']).not.toBe('*');
      const preflight = await app.inject({
        method: 'OPTIONS',
        url: '/auth/logout',
        headers: {
          origin: 'http://127.0.0.1:3000',
          'access-control-request-method': 'POST',
        },
      });
      expect(preflight.statusCode).toBe(204);
      expect(preflight.headers['access-control-allow-origin']).toBe(
        'http://127.0.0.1:3000',
      );
      const allowedLogout = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: {
          cookie: cookie(issued.token),
          origin: 'http://127.0.0.1:3000',
        },
      });
      expect(allowedLogout.statusCode).toBe(204);
    } finally {
      await app.close();
    }
  });

  it('sets a secure host-only cookie in production and HTTP-usable cookie locally', async () => {
    const user = await createUser(1);
    const issued = await service.createSession(user.id);
    for (const config of [
      localConfig,
      { ...localConfig, appEnvironment: 'production' as const },
    ]) {
      const app = buildApi(database, service, config);
      app.get('/__test/cookie', async (_request, reply) => {
        setSessionCookie(reply, issued.token, config);
        return { ok: true };
      });
      try {
        const response = await app.inject('/__test/cookie');
        const header = String(response.headers['set-cookie']);
        expect(header).toContain('HttpOnly');
        expect(header).toContain('SameSite=Lax');
        expect(header).toContain('Path=/');
        expect(header).toContain('Max-Age=1209600');
        if (config.appEnvironment === 'production') {
          expect(header).toContain('__Host-da_session=');
          expect(header).toContain('Secure');
          expect(header).not.toContain('Domain=');
        } else {
          expect(header).toContain('da_session=');
          expect(header).not.toContain('Secure');
        }
      } finally {
        await app.close();
      }
    }
  });
});
