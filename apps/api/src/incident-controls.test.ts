import { syntheticFirstUseDocuments } from '../../../tests/integration/first-use-fixtures';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PaymentService } from '@digital-autograph/payments';
import type {
  FreeClaimService,
  TakeoverQuoteService,
  TakeoverReservationService,
} from '@digital-autograph/walls';
import { LegalError } from '@digital-autograph/domain';
import { loadLegalDocuments } from '@digital-autograph/config';
import { buildApi } from './app';
import type { IncidentControls } from './incident-controls';

const id = 'f1111111-1111-4111-8111-111111111111';
const origin = 'http://127.0.0.1:3000';
const headers = { cookie: 'da_session=valid-fixture', origin };
const requests = [
  { url: `/walls/${id}/slots/${id}/free-claim`, payload: { autographId: id } },
  { url: `/walls/${id}/slots/${id}/takeover-quote`, payload: {} },
  { url: '/takeover-reservations', payload: { quoteId: id } },
  { url: '/payments/orders', payload: { reservationId: id, autographId: id } },
];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function fixture(controls?: IncidentControls) {
  const calls = requests.map(() => vi.fn(async () => ({ accepted: true })));
  const app = buildApi(
    { checkConnection: async () => {} },
    {
      validateSession: async (token) =>
        token === 'valid-fixture'
          ? {
              sessionId: id,
              expiresAt: new Date('2099-01-01'),
              user: { id, status: 'active' as const },
            }
          : null,
      revokeSession: async () => {},
      revokeAllUserSessions: async () => {},
    },
    {
      appEnvironment: 'test',
      sessionTtlSeconds: 1209600,
      trustedWebOrigins: [origin],
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { claimFreeSlot: calls[0] } as unknown as FreeClaimService,
    undefined,
    { createQuote: calls[1] } as unknown as TakeoverQuoteService,
    { create: calls[2] } as unknown as TakeoverReservationService,
    undefined,
    undefined,
    {
      create: calls[3],
      existing: async () => null,
    } as unknown as PaymentService,
    undefined,
    controls,
    {
      documents: loadLegalDocuments().map((d) =>
        d.current && ['terms_of_use', 'community_guidelines'].includes(d.type)
          ? syntheticFirstUseDocuments.find((x) => x.type === d.type)!
          : d,
      ),
      ageDeclarations: {
        declaredAt: async () => new Date(),
        declareAdult: async () => new Date(),
      },
      repository: {
        latest: async (userId, type) => {
          const d = syntheticFirstUseDocuments.find((d) => d.type === type)!;
          return {
            id,
            userId,
            documentType: type,
            documentVersion: d.version,
            documentHash: d.hash,
            action: 'accepted',
            source: 'web',
            context: 'legal_gate',
            scope: null,
            previousEventId: null,
            occurredAt: new Date(),
          };
        },
        record: async () => {
          throw new LegalError('LEGAL_DOCUMENT_UNAVAILABLE');
        },
      },
    },
  );
  apps.push(app);
  return { app, calls };
}

describe('incident admission controls', () => {
  it.each([
    { disableNewPayments: true, disableFreeClaims: false },
    { disableNewPayments: false, disableFreeClaims: true },
    { disableNewPayments: true, disableFreeClaims: true },
    { disableNewPayments: false, disableFreeClaims: false },
  ])('enforces independent server settings %j', async (controls) => {
    const { app, calls } = fixture(controls);
    for (const [index, request] of requests.entries()) {
      const disabled =
        index === 0 ? controls.disableFreeClaims : controls.disableNewPayments;
      const response = await app.inject({
        method: 'POST',
        ...request,
        headers,
      });
      if (disabled) {
        expect(response.statusCode).toBe(503);
        expect(response.json()).toEqual({
          error: {
            code:
              index === 0 ? 'FREE_CLAIMS_DISABLED' : 'NEW_PAYMENTS_DISABLED',
          },
        });
        expect(response.headers['cache-control']).toBe('no-store');
        expect(calls[index]).not.toHaveBeenCalled();
      } else {
        expect(response.statusCode).toBeLessThan(300);
        expect(calls[index]).toHaveBeenCalledOnce();
      }
    }
  });

  it('defaults to enabled admission for existing callers', async () => {
    const { app, calls } = fixture();
    for (const request of requests) {
      expect(
        (await app.inject({ method: 'POST', ...request, headers })).statusCode,
      ).toBeLessThan(300);
    }
    for (const call of calls) expect(call).toHaveBeenCalledOnce();
  });

  it('retains authentication, session revocation and Origin rejection during shutdown', async () => {
    const { app, calls } = fixture({
      disableNewPayments: true,
      disableFreeClaims: true,
    });
    for (const request of requests) {
      for (const [requestHeaders, status] of [
        [{}, 401],
        [{ ...headers, cookie: 'da_session=revoked-fixture' }, 401],
        [{ ...headers, origin: 'https://foreign.example.test' }, 403],
        [{ cookie: headers.cookie }, 403],
      ] as const) {
        expect(
          (
            await app.inject({
              method: 'POST',
              ...request,
              headers: requestHeaders,
            })
          ).statusCode,
        ).toBe(status);
      }
    }
    for (const call of calls) expect(call).not.toHaveBeenCalled();
  });

  it('ignores client overrides and captures operator settings at startup', async () => {
    const controls = { disableNewPayments: true, disableFreeClaims: true };
    const { app, calls } = fixture(controls);
    controls.disableNewPayments = false;
    controls.disableFreeClaims = false;
    for (const request of requests) {
      const response = await app.inject({
        method: 'POST',
        url: `${request.url}?DISABLE_NEW_PAYMENTS=false&DISABLE_FREE_CLAIMS=false`,
        headers: {
          ...headers,
          'disable-new-payments': 'false',
          'disable-free-claims': 'false',
        },
        payload: {
          ...request.payload,
          disableNewPayments: false,
          disableFreeClaims: false,
        },
      });
      expect(response.statusCode).toBe(503);
    }
    for (const call of calls) expect(call).not.toHaveBeenCalled();
    expect((await app.inject('/health/live')).statusCode).toBe(200);
    expect((await app.inject('/health/ready')).statusCode).toBe(200);
    expect((await app.inject({ url: '/auth/me', headers })).statusCode).toBe(
      200,
    );
    expect(
      (await app.inject({ method: 'POST', url: '/auth/logout', headers }))
        .statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: 'OPTIONS',
          url: '/payments/orders',
          headers: { origin, 'access-control-request-method': 'POST' },
        })
      ).statusCode,
    ).toBe(204);
  });
});

it.each([
  { disableNewPayments: true, disableFreeClaims: false },
  { disableNewPayments: false, disableFreeClaims: true },
  { disableNewPayments: true, disableFreeClaims: true },
  { disableNewPayments: false, disableFreeClaims: false },
])(
  'preserves legal admission alongside both incident settings %j',
  async (controls) => {
    const { app, calls } = fixture(controls);
    calls[3]!.mockImplementation(async () => {
      throw new LegalError('LEGAL_DOCUMENT_UNAVAILABLE');
    });
    const order = await app.inject({
      method: 'POST',
      ...requests[3]!,
      headers,
    });
    expect(order.statusCode).toBe(controls.disableNewPayments ? 503 : 409);
    expect(order.json().error.code).toBe(
      controls.disableNewPayments
        ? 'NEW_PAYMENTS_DISABLED'
        : 'LEGAL_DOCUMENT_UNAVAILABLE',
    );
    const claim = await app.inject({
      method: 'POST',
      ...requests[0]!,
      headers,
    });
    expect(claim.statusCode).toBe(controls.disableFreeClaims ? 503 : 200);
    const document = loadLegalDocuments().find((d) => d.current)!;
    expect((await app.inject(document.path)).statusCode).toBe(404);
    const acceptance = await app.inject({
      method: 'POST',
      url: '/legal/accept',
      headers,
      payload: {
        type: 'terms_of_use',
        version: document.version,
        hash: document.hash,
      },
    });
    expect(acceptance.statusCode).toBe(409);
    expect(acceptance.json().error.code).toBe('LEGAL_DOCUMENT_CHANGED');
  },
);
