import { randomUUID } from 'node:crypto';
import { beforeEach, afterAll, expect, it, vi } from 'vitest';
import {
  createDatabase,
  createPgSessionRepository,
  createPgLegalRepository,
  createPgAgeDeclarationRepository,
  createPgAutographRepository,
} from '../../packages/db/src/index';
import { SessionService } from '../../packages/auth/src/index';
import { AutographService } from '../../packages/autographs/src/index';
import { buildApi } from '../../apps/api/src/app';
import type { LegalHttp } from '../../apps/api/src/legal-http';
import type {
  FreeClaimService,
  TakeoverQuoteService,
  TakeoverReservationService,
} from '../../packages/walls/src/index';
import type { PaymentService } from '../../packages/payments/src/index';
import { loadLegalDocuments } from '../../packages/config/src/index';
import { syntheticFirstUseDocuments } from './first-use-fixtures';
import type { IncidentControls } from '../../apps/api/src/incident-controls';
const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/autograph_test')
  throw new Error('Isolated DB required');
const db = createDatabase(url);
const repo = createPgLegalRepository(db.pool);
const age = createPgAgeDeclarationRepository(db.pool);
const sessions = new SessionService(
  createPgSessionRepository(db.pool),
  1209600,
);
const origin = 'http://127.0.0.1:3000';
let user: string, other: string, headers: Record<string, string>;
beforeEach(async () => {
  await db.pool.query('TRUNCATE users CASCADE');
  user = randomUUID();
  other = randomUUID();
  await db.pool.query('INSERT INTO users(id) VALUES ($1),($2)', [user, other]);
  headers = {
    cookie: `da_session=${(await sessions.createSession(user)).token}`,
    origin,
  };
});
afterAll(() => db.close());
const synthetic = () => syntheticFirstUseDocuments.map((d) => ({ ...d }));
function api(
  documents = synthetic(),
  controls?: IncidentControls,
  configured = true,
  enforced = true,
) {
  const calls = {
    claim: vi.fn(async () => ({ created: true })),
    quote: vi.fn(async () => ({})),
    reservation: vi.fn(async () => ({ created: true, reservation: {} })),
    order: vi.fn(async () => ({})),
    refresh: vi.fn(async () => ({})),
    status: vi.fn(async () => ({})),
    webhook: vi.fn(async () => {}),
  };
  const legal: LegalHttp = {
    repository: repo,
    ageDeclarations: age,
    documents,
  };
  const app = buildApi(
    db,
    sessions,
    {
      appEnvironment: 'test',
      sessionTtlSeconds: 1209600,
      trustedWebOrigins: [origin],
      firstUseEnforced: enforced,
    },
    undefined,
    undefined,
    undefined,
    new AutographService(
      createPgAutographRepository(db.pool),
      {} as ConstructorParameters<typeof AutographService>[1],
      300,
    ),
    undefined,
    { claimFreeSlot: calls.claim } as unknown as FreeClaimService,
    undefined,
    { createQuote: calls.quote } as unknown as TakeoverQuoteService,
    { create: calls.reservation } as unknown as TakeoverReservationService,
    undefined,
    undefined,
    {
      create: calls.order,
      existing: async () => null,
      refresh: calls.refresh,
      status: calls.status,
      webhook: calls.webhook,
    } as unknown as PaymentService,
    undefined,
    controls,
    configured ? legal : undefined,
  );
  return { app, calls, documents };
}
const post = (
  app: ReturnType<typeof api>['app'],
  url: string,
  payload: unknown,
  h = headers,
) =>
  app.inject({
    method: 'POST',
    url,
    payload: JSON.stringify(payload),
    headers: { ...h, 'content-type': 'application/json' },
  });
const requirements = (docs = synthetic()) =>
  docs.filter((d) => ['terms_of_use', 'community_guidelines'].includes(d.type));
it('keeps existing actions available with the real unpublished registry when enforcement is disabled, without fabricating evidence', async () => {
  const { app, calls } = api(loadLegalDocuments(), undefined, true, false);
  try {
    expect(
      (await app.inject({ url: '/legal/first-use', headers })).json(),
    ).toEqual({
      enforced: false,
      available: false,
      complete: false,
      adultDeclared: false,
      documents: [],
    });
    expect(
      (await post(app, '/autographs', { source: 'canvas' })).statusCode,
    ).toBe(201);
    expect(
      (
        await post(
          app,
          `/walls/${randomUUID()}/slots/${randomUUID()}/free-claim`,
          { autographId: randomUUID() },
        )
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await post(
          app,
          `/walls/${randomUUID()}/slots/${randomUUID()}/takeover-quote`,
          {},
        )
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await post(
          app,
          '/takeover-reservations',
          { quoteId: randomUUID() },
          { ...headers, 'idempotency-key': 'synthetic-replay-key-01' },
        )
      ).statusCode,
    ).toBe(201);
    expect(calls.claim).toHaveBeenCalledOnce();
    expect(calls.quote).toHaveBeenCalledOnce();
    expect(calls.reservation).toHaveBeenCalledOnce();
    expect(
      (await post(app, '/legal/first-use/age', { adultDeclared: true })).json()
        .error.code,
    ).toBe('FIRST_USE_DISABLED');
    expect(
      (await db.pool.query('SELECT * FROM age_declarations')).rowCount,
    ).toBe(0);
    expect(
      (await db.pool.query('SELECT * FROM legal_evidence_events')).rowCount,
    ).toBe(0);
    expect(
      (
        await app.inject({
          url: '/legal/documents/terms_of_use/1.0-destka-20261010',
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await post(app, '/autographs', { source: 'canvas' }, {})).statusCode,
    ).toBe(401);
    expect(
      (
        await post(
          app,
          '/autographs',
          { source: 'canvas' },
          { ...headers, origin: 'https://evil.test' },
        )
      ).statusCode,
    ).toBe(403);
  } finally {
    await app.close();
  }
});
async function acceptAll(
  app: ReturnType<typeof api>['app'],
  docs = synthetic(),
) {
  expect(
    (await post(app, '/legal/first-use/age', { adultDeclared: true }))
      .statusCode,
  ).toBe(200);
  for (const d of requirements(docs))
    expect(
      (
        await post(app, '/legal/accept', {
          type: d.type,
          version: d.version,
          hash: d.hash,
        })
      ).statusCode,
    ).toBe(200);
}
it('anonymous acceptance and age are rejected, OAuth session alone is insufficient, Origin is checked first', async () => {
  const { app } = api();
  try {
    expect(
      (await post(app, '/legal/first-use/age', { adultDeclared: true }, {}))
        .statusCode,
    ).toBe(401);
    expect(
      (await post(app, '/legal/accept', { ...requirements()[0] }, {}))
        .statusCode,
    ).toBe(401);
    expect((await app.inject({ url: '/auth/me', headers })).statusCode).toBe(
      200,
    );
    expect(
      (await post(app, '/autographs', { source: 'canvas' })).json().error.code,
    ).toBe('FIRST_USE_REQUIRED');
    expect(
      (
        await post(
          app,
          '/autographs',
          { source: 'canvas' },
          { ...headers, origin: 'https://evil.test' },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (await db.pool.query('SELECT * FROM age_declarations')).rowCount,
    ).toBe(0);
  } finally {
    await app.close();
  }
});
it('partial onboarding stays blocked; full evidence unlocks real PostgreSQL autograph creation without personal consent', async () => {
  const { app } = api();
  try {
    const [terms, rules] = requirements();
    const t = await post(app, '/legal/accept', {
      type: terms!.type,
      version: terms!.version,
      hash: terms!.hash,
    });
    expect(t.json().event).toMatchObject({
      userId: user,
      documentType: terms!.type,
      documentVersion: terms!.version,
      documentHash: terms!.hash,
      action: 'accepted',
      scope: null,
      context: 'legal_gate',
      source: 'web',
    });
    expect(
      (await post(app, '/autographs', { source: 'canvas' })).statusCode,
    ).toBe(409);
    await post(app, '/legal/accept', {
      type: rules!.type,
      version: rules!.version,
      hash: rules!.hash,
    });
    expect(
      (await post(app, '/autographs', { source: 'canvas' })).statusCode,
    ).toBe(409);
    expect(
      (await post(app, '/legal/first-use/age', { adultDeclared: false }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await post(app, '/legal/first-use/age', {
          adultDeclared: true,
          userId: other,
        })
      ).statusCode,
    ).toBe(400);
    await post(app, '/legal/first-use/age', { adultDeclared: true });
    expect(
      (await app.inject({ url: '/legal/first-use', headers })).json(),
    ).toMatchObject({ complete: true, adultDeclared: true });
    expect(
      (await post(app, '/autographs', { source: 'canvas' })).statusCode,
    ).toBe(201);
    expect(
      (
        await db.pool.query(
          "SELECT * FROM legal_evidence_events WHERE action <> 'accepted' OR document_type NOT IN ('terms_of_use','community_guidelines')",
        )
      ).rowCount,
    ).toBe(0);
    expect((await repo.latest(user, rules!.type))!.id).not.toBe(
      t.json().event.id,
    );
  } finally {
    await app.close();
  }
});
it('concurrent retries across pools return identical immutable age/evidence; DB owns timestamps', async () => {
  const { app } = api();
  const second = createDatabase(url!);
  try {
    await Promise.all(Array.from({ length: 20 }, () => acceptAll(app)));
    const ages = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        (i % 2
          ? age
          : createPgAgeDeclarationRepository(second.pool)
        ).declareAdult(user),
      ),
    );
    expect(new Set(ages.map((a) => a.toISOString())).size).toBe(1);
    expect(
      (await db.pool.query('SELECT * FROM age_declarations')).rowCount,
    ).toBe(1);
    expect(
      (await db.pool.query('SELECT * FROM legal_evidence_events')).rowCount,
    ).toBe(2);
    for (const sql of [
      'UPDATE age_declarations SET declared_at=now() WHERE user_id=$1',
      'DELETE FROM age_declarations WHERE user_id=$1',
    ])
      await expect(db.pool.query(sql, [user])).rejects.toMatchObject({
        code: '23514',
      });
    await db.pool.query(
      "INSERT INTO age_declarations(user_id,declared_at) VALUES($1,'1900-01-01')",
      [other],
    );
    expect((await age.declaredAt(other))!.getUTCFullYear()).toBeGreaterThan(
      2025,
    );
  } finally {
    await app.close();
    await second.close();
  }
});
it('stale version/hash records nothing; new operator-approved edition requires acceptance, preserving predecessors', async () => {
  const { app, documents } = api();
  try {
    await acceptAll(app);
    const previous = await repo.latest(user, 'terms_of_use');
    const term = documents.find((d) => d.type === 'terms_of_use')!;
    const old = { ...term };
    term.version = 'test-v2';
    term.hash = 'b'.repeat(64);
    term.path = '/legal/documents/terms_of_use/test-v2';
    expect(
      (await post(app, '/autographs', { source: 'canvas' })).json().error.code,
    ).toBe('FIRST_USE_REQUIRED');
    for (const identity of [
      { version: old.version, hash: old.hash },
      { version: term.version, hash: old.hash },
    ])
      expect(
        (
          await post(app, '/legal/accept', { type: term.type, ...identity })
        ).json().error.code,
      ).toBe('LEGAL_DOCUMENT_CHANGED');
    expect((await repo.latest(user, 'terms_of_use'))!.id).toBe(previous!.id);
    await post(app, '/legal/accept', {
      type: term.type,
      version: term.version,
      hash: term.hash,
    });
    expect((await repo.latest(user, 'terms_of_use'))!.previousEventId).toBe(
      previous!.id,
    );
    expect(
      (await post(app, '/autographs', { source: 'canvas' })).statusCode,
    ).toBe(201);
  } finally {
    await app.close();
  }
});
it('real ready:false and missing registry fail closed without age/evidence, text or accept options', async () => {
  for (const configured of [true, false]) {
    const { app } = api(loadLegalDocuments(), undefined, configured);
    try {
      expect(
        (await post(app, '/autographs', { source: 'canvas' })).json().error
          .code,
      ).toBe('LEGAL_DOCUMENT_UNAVAILABLE');
      if (configured) {
        expect(
          (await app.inject({ url: '/legal/first-use', headers })).json(),
        ).toEqual({
          enforced: true,
          available: false,
          complete: false,
          adultDeclared: false,
          documents: [],
        });
        expect(
          (await post(app, '/legal/first-use/age', { adultDeclared: true }))
            .statusCode,
        ).toBe(409);
        for (const d of loadLegalDocuments())
          expect((await app.inject(d.path)).statusCode).toBe(404);
      }
      expect(
        (await db.pool.query('SELECT * FROM age_declarations')).rowCount,
      ).toBe(0);
    } finally {
      await app.close();
    }
  }
});
it('legacy consent cannot authorize and another subject cannot read/override first-use state', async () => {
  const { app } = api();
  try {
    await db.pool.query(
      "INSERT INTO consent_records(user_id,document_type,document_version,source) VALUES($1,'terms','1.0','web')",
      [user],
    );
    expect(
      (await app.inject({ url: '/legal/first-use', headers })).json().complete,
    ).toBe(false);
    await acceptAll(app);
    const otherHeaders = {
      cookie: `da_session=${(await sessions.createSession(other)).token}`,
    };
    expect(
      (
        await app.inject({
          url: `/legal/first-use?userId=${user}`,
          headers: otherHeaders,
        })
      ).json().complete,
    ).toBe(false);
    expect(
      (
        await app.inject({
          url: '/legal/state/terms_of_use',
          headers: otherHeaders,
        })
      ).json().latest,
    ).toBeNull();
    expect((await post(app, '/auth/logout', {})).statusCode).toBe(204);
  } finally {
    await app.close();
  }
});
it.each([false, true])(
  'guards every admission mutation while existing owner recovery and provider callbacks stay available (incident=%s)',
  async (disabled) => {
    const { app, calls } = api(synthetic(), {
      disableNewPayments: disabled,
      disableFreeClaims: disabled,
    });
    const id = randomUUID();
    try {
      for (const [path, body] of [
        ['/autographs', { source: 'photo' }],
        [
          `/autographs/${id}/upload`,
          { contentType: 'image/png', sizeBytes: 4 },
        ],
        [`/autographs/${id}/upload/complete`, {}],
        [`/autographs/${id}/approve`, { reviewedAssetId: id }],
        [`/walls/${id}/slots/${id}/free-claim`, { autographId: id }],
        [`/walls/${id}/slots/${id}/takeover-quote`, {}],
        ['/takeover-reservations', { quoteId: id }],
        ['/payments/orders', { reservationId: id, autographId: id }],
      ] as const) {
        const r = await post(app, path, body);
        expect(r.statusCode).toBe(
          disabled && !path.startsWith('/autographs') ? 503 : 409,
        );
      }
      for (const fn of [
        calls.claim,
        calls.quote,
        calls.reservation,
        calls.order,
      ])
        expect(fn).not.toHaveBeenCalled();
      expect(
        (await post(app, `/payments/orders/${id}/refresh`, {})).statusCode,
      ).toBe(200);
      expect(
        (await app.inject({ url: `/payments/orders/${id}`, headers }))
          .statusCode,
      ).toBe(200);
      expect(
        (
          await post(
            app,
            '/payments/webhooks/yookassa',
            {
              type: 'notification',
              event: 'payment.succeeded',
              object: { id },
            },
            {},
          )
        ).statusCode,
      ).toBe(200);
      expect(calls.webhook).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  },
);
