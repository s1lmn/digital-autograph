import type { PaymentService } from '@digital-autograph/payments';
import { registerPaymentRoutes } from './payments/http';
import {
  liveHealthResponse,
  readyHealthResponse,
} from '@digital-autograph/contracts';
import type { Database } from '@digital-autograph/db';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { apiLoggerOptions, registerSafeApiErrors } from './logging';
import {
  registerGoogleRoutes,
  type GoogleHttpConfig,
} from './auth/google-http';
import type { GoogleLoginService } from './auth/google-login';
import {
  registerTelegramRoutes,
  type TelegramHttpConfig,
} from './auth/telegram-http';
import type { TelegramLoginService } from './auth/telegram-login';
import type {
  FreeClaimService,
  PublicPlacementMediaService,
  WallService,
  TakeoverQuoteService,
  TakeoverReservationService,
  PlacementHistoryService,
} from '@digital-autograph/walls';
import type { AutographService } from '@digital-autograph/autographs';
import type { ModerationService } from '@digital-autograph/autographs';
import { registerAutographRoutes } from './autographs/http';
import { registerModerationRoutes } from './autographs/moderation-http';
import { registerWallRoutes } from './walls/http';
import { registerFreeClaimRoutes } from './walls/free-claim-http';
import { registerPublicPlacementMediaRoutes } from './walls/public-media-http';
import { registerPricingRoutes } from './walls/pricing-http';
import { registerTakeoverReservationRoutes } from './walls/reservation-http';
import { registerPlacementHistoryRoutes } from './walls/placement-history-http';
import {
  invalidOrigin,
  registerAuthRoutes,
  sessionCookieName,
  type AuthHttpConfig,
  type HttpSessionService,
} from './auth/http';
import { registerTestAuthRoutes } from './auth/test-auth-http';
import type { SessionService } from '@digital-autograph/auth';

type DatabaseProbe = Pick<Database, 'checkConnection'>;

export function buildApi(
  database: DatabaseProbe,
  sessions: HttpSessionService,
  authConfig: AuthHttpConfig,
  google?: { login: GoogleLoginService; config: GoogleHttpConfig },
  telegram?: { login: TelegramLoginService; config: TelegramHttpConfig },
  walls?: WallService,
  autographs?: AutographService,
  moderation?: ModerationService,
  claims?: FreeClaimService,
  publicMedia?: PublicPlacementMediaService,
  pricing?: TakeoverQuoteService,
  reservations?: TakeoverReservationService,
  testAuth?: {
    sessions: Pick<SessionService, 'createSession'>;
    userId: string;
    webOrigin: string;
  },
  placementHistory?: PlacementHistoryService,
  payments?: PaymentService,
) {
  const app = Fastify({
    logger: apiLoggerOptions(),
  });
  registerSafeApiErrors(app);

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header(
      'Content-Security-Policy',
      "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
    );
    if (!reply.hasHeader('Referrer-Policy')) {
      reply.header('Referrer-Policy', 'no-referrer');
    }
    return payload;
  });

  app.register(cookie);
  app.register(cors, {
    origin: [...authConfig.trustedWebOrigins],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Idempotency-Key'],
    strictPreflight: true,
  });
  app.decorateRequest('authContext', null);
  app.addHook('preHandler', async (request, reply) => {
    request.authContext = { kind: 'anonymous' };
    if (invalidOrigin(request, authConfig)) {
      return reply.code(403).send({ error: { code: 'INVALID_ORIGIN' } });
    }
    if (request.url.startsWith('/health/')) return;
    const token = request.cookies[sessionCookieName(authConfig)];
    if (!token) return;
    const session = await sessions.validateSession(token);
    if (session) request.authContext = { kind: 'authenticated', session };
  });

  app.get('/health/live', async () =>
    liveHealthResponse.parse({ status: 'ok' }),
  );

  app.get('/health/ready', async (_request, reply) => {
    try {
      await database.checkConnection();
      return readyHealthResponse.parse({ status: 'ready' });
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  registerAuthRoutes(app, sessions, authConfig);
  if (testAuth) {
    registerTestAuthRoutes(
      app,
      testAuth.sessions,
      authConfig,
      testAuth.userId,
      testAuth.webOrigin,
    );
  }
  if (google)
    registerGoogleRoutes(app, google.login, authConfig, google.config);
  if (telegram)
    registerTelegramRoutes(app, telegram.login, authConfig, telegram.config);
  if (walls) registerWallRoutes(app, walls);
  if (claims) registerFreeClaimRoutes(app, claims);
  if (publicMedia) registerPublicPlacementMediaRoutes(app, publicMedia);
  if (pricing) registerPricingRoutes(app, pricing);
  if (reservations) registerTakeoverReservationRoutes(app, reservations);
  if (placementHistory) registerPlacementHistoryRoutes(app, placementHistory);
  if (autographs) registerAutographRoutes(app, autographs);
  if (moderation) registerModerationRoutes(app, moderation);

  if (payments) registerPaymentRoutes(app, payments);
  return app;
}
