import { PaymentService } from '@digital-autograph/payments';
import { createPgPaymentRepository } from '@digital-autograph/db';
import { createYookassaProvider } from '@digital-autograph/integrations';
import { loadApiConfig, loadPaymentConfig } from '@digital-autograph/config';
import {
  IdentityService,
  OAuthAttemptService,
  SessionService,
} from '@digital-autograph/auth';
import {
  createDatabase,
  createPgOAuthAttemptRepository,
  createPgProviderIdentityRepository,
  createPgSessionRepository,
  createPgWallRepository,
  createPgPlacementHistoryRepository,
  createPgFreeClaimRepository,
  createPgPublicPlacementMediaRepository,
  createPgPricingRepository,
  createPgTakeoverReservationRepository,
  createPgAutographRepository,
  createPgAutographModerationRepository,
} from '@digital-autograph/db';
import {
  AutographService,
  ModerationService,
} from '@digital-autograph/autographs';
import {
  FreeClaimService,
  PlacementHistoryService,
  PublicPlacementMediaService,
  WallService,
  TakeoverQuoteService,
  TakeoverReservationService,
} from '@digital-autograph/walls';
import {
  createGoogleOidcClient,
  createTelegramOidcClient,
  createPrivateS3Storage,
} from '@digital-autograph/integrations';
import { buildApi } from './app';
import {
  GoogleLoginService,
  googleLoginAttemptTtlSeconds,
} from './auth/google-login';
import { TelegramLoginService } from './auth/telegram-login';
import { NotificationService } from '@digital-autograph/notifications';
import {
  createPgNotificationRepository,
  createPgShareRepository,
} from '@digital-autograph/db';
import { loadNotificationTelegramApiConfig } from '@digital-autograph/config';

async function main(): Promise<void> {
  const config = loadApiConfig();
  const paymentConfig = loadPaymentConfig();
  const notificationTelegram = loadNotificationTelegramApiConfig();
  const enableTestAuthSeam = process.env.ENABLE_TEST_AUTH_SEAM === 'true';
  if (
    enableTestAuthSeam &&
    (config.APP_ENV !== 'test' || process.env.NODE_ENV === 'production')
  ) {
    throw new Error(
      'ENABLE_TEST_AUTH_SEAM is only permitted in a non-production test environment',
    );
  }
  const database = createDatabase(config.DATABASE_URL);
  const storage = createPrivateS3Storage({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    bucket: config.S3_BUCKET,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
  });
  if (['local', 'test', 'development'].includes(config.APP_ENV)) {
    await storage.bootstrapLocalBucket();
  }
  const sessions = new SessionService(
    createPgSessionRepository(database.pool),
    config.SESSION_TTL_SECONDS,
  );
  const attempts = new OAuthAttemptService(
    createPgOAuthAttemptRepository(database.pool),
    googleLoginAttemptTtlSeconds,
  );
  const identities = new IdentityService(
    createPgProviderIdentityRepository(database.pool),
  );
  const googleLogin = new GoogleLoginService(
    attempts,
    createGoogleOidcClient({
      clientId: config.GOOGLE_CLIENT_ID,
      clientSecret: config.GOOGLE_CLIENT_SECRET,
      redirectUri: config.GOOGLE_REDIRECT_URI,
    }),
    identities,
    sessions,
  );
  const telegramLogin = new TelegramLoginService(
    attempts,
    createTelegramOidcClient({
      clientId: config.TELEGRAM_CLIENT_ID,
      clientSecret: config.TELEGRAM_CLIENT_SECRET,
      redirectUri: config.TELEGRAM_REDIRECT_URI,
    }),
    identities,
    sessions,
  );
  const payments = paymentConfig
    ? new PaymentService(
        createPgPaymentRepository(database.pool),
        createYookassaProvider({
          shopId: paymentConfig.YOOKASSA_SHOP_ID,
          secretKey: paymentConfig.YOOKASSA_SECRET_KEY,
        }),
        {
          shopId: paymentConfig.YOOKASSA_SHOP_ID,
          mode: paymentConfig.PAYMENT_MODE,
          returnUrl: paymentConfig.PAYMENT_RETURN_URL,
          creatorShareBps: paymentConfig.PAYMENT_CREATOR_SHARE_BPS,
        },
        (signal) => console.warn(JSON.stringify(signal)),
      )
    : undefined;
  const app = buildApi(
    database,
    sessions,
    {
      appEnvironment: config.APP_ENV,
      sessionTtlSeconds: config.SESSION_TTL_SECONDS,
      trustedWebOrigins: config.TRUSTED_WEB_ORIGINS,
    },
    {
      login: googleLogin,
      config: { appEnvironment: config.APP_ENV, webOrigin: config.WEB_ORIGIN },
    },
    {
      login: telegramLogin,
      config: { appEnvironment: config.APP_ENV, webOrigin: config.WEB_ORIGIN },
    },
    new WallService(createPgWallRepository(database.pool)),
    new AutographService(
      createPgAutographRepository(database.pool),
      storage,
      config.UPLOAD_URL_TTL_SECONDS,
      undefined,
      config.PREVIEW_URL_TTL_SECONDS,
    ),
    new ModerationService(
      createPgAutographModerationRepository(database.pool),
      storage,
      config.PREVIEW_URL_TTL_SECONDS,
    ),
    new FreeClaimService(createPgFreeClaimRepository(database.pool)),
    new PublicPlacementMediaService(
      createPgPublicPlacementMediaRepository(database.pool),
      storage,
    ),
    new TakeoverQuoteService(createPgPricingRepository(database.pool)),
    new TakeoverReservationService(
      createPgTakeoverReservationRepository(database.pool),
    ),
    enableTestAuthSeam
      ? {
          sessions,
          userId: process.env.E2E_AUTH_USER_ID ?? '',
          webOrigin: config.WEB_ORIGIN,
        }
      : undefined,
    new PlacementHistoryService(
      createPgPlacementHistoryRepository(database.pool),
    ),
    payments,
    {
      service: new NotificationService(
        createPgNotificationRepository(database.pool),
      ),
      shares: createPgShareRepository(database.pool),
      telegram: notificationTelegram
        ? {
            username: notificationTelegram.NOTIFICATION_TELEGRAM_BOT_USERNAME,
            secret: notificationTelegram.NOTIFICATION_TELEGRAM_WEBHOOK_SECRET,
          }
        : undefined,
    },
  );
  let closing = false;

  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    try {
      await app.close();
      await database.close();
      storage.close();
    } catch (error) {
      app.log.error(error, 'API shutdown failed');
      process.exitCode = 1;
    }
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());

  try {
    await app.listen({ host: config.API_HOST, port: config.API_PORT });
  } catch (error) {
    app.log.error(error, 'API startup failed');
    await shutdown();
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
