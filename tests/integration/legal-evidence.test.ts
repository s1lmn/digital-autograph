import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, expect, it } from 'vitest';
import {
  createDatabase,
  createPgLegalRepository,
  createPgSessionRepository,
} from '../../packages/db/src/index';
import { SessionService } from '../../packages/auth/src/index';
import {
  isCurrentLegalState,
  type LegalDocument,
  type LegalScope,
} from '../../packages/domain/src/index';
import { loadLegalDocuments } from '../../packages/config/src/index';
import { buildApi } from '../../apps/api/src/app';
import { registerLegalRoutes } from '../../apps/api/src/legal-http';
import { syntheticLegalDocuments } from './legal-fixtures';
const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/autograph_test')
  throw new Error('Legal tests require isolated autograph_test');
const database = createDatabase(url);
const repo = createPgLegalRepository(database.pool);
const sessions = new SessionService(
  createPgSessionRepository(database.pool),
  1209600,
);
const terms = syntheticLegalDocuments.find((d) => d.type === 'terms_of_use')!;
const consent = syntheticLegalDocuments.find(
  (d) => d.type === 'personal_data_consent',
)!;
const scope: LegalScope = {
  purpose: 'optional_notifications',
  dataItems: ['contact'],
  resourceUrls: [],
  conditions: [],
};
let user: string, other: string;
beforeEach(async () => {
  await database.pool.query('TRUNCATE users CASCADE');
  user = randomUUID();
  other = randomUUID();
  await database.pool.query('INSERT INTO users(id) VALUES ($1),($2)', [
    user,
    other,
  ]);
});
afterAll(() => database.close());
const record = (d: LegalDocument = terms) =>
  repo.record(user, d, 'accepted', 'web', 'legal_gate');
it('records initial evidence with DB clock, deduplicates retries and records a new version', async () => {
  const first = await record();
  expect(first).toMatchObject({
    userId: user,
    documentHash: terms.hash,
    action: 'accepted',
  });
  expect((await record())!.id).toBe(first!.id);
  const second = await record({
    ...terms,
    version: 'test-v2',
    hash: 'b'.repeat(64),
  });
  expect(second!.previousEventId).toBe(first!.id);
  expect(isCurrentLegalState(await repo.latest(user, terms.type), terms)).toBe(
    false,
  );
  expect(
    (await database.pool.query('SELECT * FROM legal_evidence_events')).rowCount,
  ).toBe(2);
});
it('serializes 30 identical acceptances across independent application pools', async () => {
  const second = createDatabase(url!);
  try {
    const otherRepo = createPgLegalRepository(second.pool);
    const events = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        (i % 2 ? repo : otherRepo).record(
          user,
          terms,
          'accepted',
          'web',
          'legal_gate',
        ),
      ),
    );
    expect(new Set(events.map((e) => e!.id)).size).toBe(1);
  } finally {
    await second.close();
  }
});
it('withdrawal appends the actual prior grant; repeated withdrawal is idempotent; regrant appends', async () => {
  const grant = await repo.record(
    user,
    consent,
    'granted',
    'web',
    'optional_notifications',
    scope,
  );
  const newDocument = {
    ...consent,
    version: 'test-v2',
    hash: 'c'.repeat(64),
    ready: false,
  };
  const withdrawals = await Promise.all(
    Array.from({ length: 20 }, () =>
      repo.record(
        user,
        newDocument,
        'withdrawn',
        'web',
        'privacy_settings',
        scope,
      ),
    ),
  );
  expect(new Set(withdrawals.map((e) => e!.id)).size).toBe(1);
  expect(withdrawals[0]).toMatchObject({
    action: 'withdrawn',
    documentVersion: consent.version,
    documentHash: consent.hash,
    previousEventId: grant!.id,
    scope,
  });
  expect(
    isCurrentLegalState(
      await repo.latest(user, consent.type, scope.purpose),
      consent,
    ),
  ).toBe(false);
  const again = await repo.record(
    user,
    consent,
    'granted',
    'web',
    'optional_notifications',
    scope,
  );
  expect(again!.previousEventId).toBe(withdrawals[0]!.id);
  expect(
    isCurrentLegalState(
      await repo.latest(user, consent.type, scope.purpose),
      consent,
    ),
  ).toBe(true);
  expect(
    (await database.pool.query('SELECT * FROM legal_evidence_events')).rowCount,
  ).toBe(3);
});
it('keeps optional purposes separate and does not revoke another subject', async () => {
  await repo.record(
    user,
    consent,
    'granted',
    'web',
    'optional_notifications',
    scope,
  );
  await repo.record(user, consent, 'granted', 'web', 'optional_profile', {
    ...scope,
    purpose: 'optional_profile',
    dataItems: ['display_name'],
  });
  await repo.record(
    user,
    consent,
    'withdrawn',
    'web',
    'privacy_settings',
    scope,
  );
  expect(
    (await repo.latest(user, consent.type, 'optional_profile'))!.action,
  ).toBe('granted');
  expect(await repo.latest(other, consent.type, scope.purpose)).toBeNull();
});
it('rejects old evidence update/delete and direct invalid hashes/types/actions/chains', async () => {
  const event = await record();
  for (const sql of [
    "UPDATE legal_evidence_events SET document_hash=repeat('b',64) WHERE id=$1",
    'DELETE FROM legal_evidence_events WHERE id=$1',
  ])
    await expect(database.pool.query(sql, [event!.id])).rejects.toMatchObject({
      code: '23514',
    });
  for (const [type, hash, action] of [
    ['unregistered', 'a'.repeat(64), 'accepted'],
    ['community_guidelines', 'bad', 'accepted'],
    ['personal_data_consent', 'a'.repeat(64), 'accepted'],
  ]) {
    await expect(
      database.pool.query(
        "INSERT INTO legal_evidence_events(user_id,document_type,document_version,document_hash,action,source,context) VALUES($1,$2,'1',$3,$4,'web','legal_gate')",
        [user, type, hash, action],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  }
  await expect(
    repo.record(
      user,
      { ...consent, type: 'personal_data_dissemination_consent' },
      'granted',
      'web',
      'public_profile',
      scope,
    ),
  ).rejects.toThrow('INVALID_LEGAL_ACTION');
  await expect(record({ ...terms, ready: false })).rejects.toThrow(
    'LEGAL_DOCUMENT_UNAVAILABLE',
  );
  await database.pool.query("UPDATE users SET status='disabled' WHERE id=$1", [
    user,
  ]);
  await expect(record()).rejects.toThrow('LEGAL_USER_UNAVAILABLE');
});
it('HTTP uses session subject, exact Origin and current registry; rejects client evidence/version spoofing', async () => {
  const app = buildApi(database, sessions, {
    appEnvironment: 'test',
    sessionTtlSeconds: 1209600,
    trustedWebOrigins: ['http://127.0.0.1:3000'],
  });
  registerLegalRoutes(app, {
    repository: repo,
    documents: [
      { ...terms, version: 'archived-v0', current: false },
      ...syntheticLegalDocuments,
    ].map((d) => ({
      ...d,
      content: `fixture ${d.type}`,
    })),
  });
  const token = (await sessions.createSession(user)).token;
  const otherToken = (await sessions.createSession(other)).token;
  const headers = {
    cookie: `da_session=${token}`,
    origin: 'http://127.0.0.1:3000',
  };
  try {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/legal/accept',
          payload: {
            type: 'terms_of_use',
            version: terms.version,
            hash: terms.hash,
          },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/legal/accept',
          headers: { ...headers, origin: 'https://evil.test' },
          payload: {
            type: 'terms_of_use',
            version: terms.version,
            hash: terms.hash,
          },
        })
      ).statusCode,
    ).toBe(403);
    for (const extra of [
      { userId: other },
      { version: 'old' },
      { hash: 'b'.repeat(64) },
      { scope },
      { source: 'forged' },
    ])
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/legal/accept',
            headers,
            payload: { type: 'terms_of_use', ...extra },
          })
        ).statusCode,
      ).toBe(400);
    for (const type of [
      'arbitrary',
      'privacy_policy',
      'personal_data_consent',
      'personal_data_dissemination_consent',
    ])
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/legal/accept',
            headers,
            payload: { type },
          })
        ).statusCode,
      ).toBe(400);
    for (const changed of [
      { version: 'archived-v0', hash: terms.hash },
      { version: terms.version, hash: 'c'.repeat(64) },
    ]) {
      const stale = await app.inject({
        method: 'POST',
        url: '/legal/accept',
        headers,
        payload: { type: 'terms_of_use', ...changed },
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toEqual({
        error: { code: 'LEGAL_DOCUMENT_CHANGED' },
      });
    }
    expect(await repo.latest(user, terms.type)).toBeNull();
    const accepted = await app.inject({
      method: 'POST',
      url: '/legal/accept',
      headers,
      payload: {
        type: 'terms_of_use',
        version: terms.version,
        hash: terms.hash,
      },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().event.userId).toBe(user);
    const ownState = await app.inject({
      url: '/legal/state/terms_of_use',
      headers,
    });
    expect(ownState.json()).toMatchObject({
      document: { version: terms.version },
      current: true,
    });
    const state = await app.inject({
      url: '/legal/state/terms_of_use',
      headers: { cookie: `da_session=${otherToken}` },
    });
    expect(state.json()).toMatchObject({ latest: null, current: false });
    expect(
      (await app.inject({ url: '/legal/documents/terms_of_use/test-v1' })).body,
    ).toBe('fixture terms_of_use');
    await repo.record(
      user,
      consent,
      'granted',
      'web',
      'optional_notifications',
      scope,
    );
    const withdrawn = await app.inject({
      method: 'POST',
      url: '/legal/withdraw',
      headers,
      payload: { type: 'personal_data_consent', purpose: scope.purpose },
    });
    expect(withdrawn.json().event.action).toBe('withdrawn');
  } finally {
    await app.close();
  }
});

it('authenticated sessions cannot expose or accept real unapproved Destka/legacy documents', async () => {
  const app = buildApi(database, sessions, {
    appEnvironment: 'test',
    sessionTtlSeconds: 1209600,
    trustedWebOrigins: ['http://127.0.0.1:3000'],
  });
  const documents = loadLegalDocuments();
  registerLegalRoutes(app, { repository: repo, documents });
  const headers = {
    cookie: `da_session=${(await sessions.createSession(user)).token}`,
    origin: 'http://127.0.0.1:3000',
  };
  try {
    for (const document of documents) {
      for (const requestHeaders of [{}, headers]) {
        const response = await app.inject({
          url: document.path,
          headers: requestHeaders,
        });
        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({
          error: { code: 'LEGAL_DOCUMENT_NOT_FOUND' },
        });
      }
    }
    const document = documents.find(
      (d) => d.type === 'terms_of_use' && d.current,
    )!;
    const response = await app.inject({
      method: 'POST',
      url: '/legal/accept',
      headers,
      payload: {
        type: document.type,
        version: document.version,
        hash: document.hash,
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('LEGAL_DOCUMENT_UNAVAILABLE');
    expect(await repo.latest(user, document.type)).toBeNull();
  } finally {
    await app.close();
  }
});
