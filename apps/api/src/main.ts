import { loadApiConfig } from '@digital-autograph/config';
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
  createPgFreeClaimRepository,
  createPgPublicPlacementMediaRepository,
  createPgAutographRepository,
  createPgAutographModerationRepository,
} from '@digital-autograph/db';
import {
  AutographService,
  ModerationService,
} from '@digital-autograph/autographs';
import {
  FreeClaimService,
  PublicPlacementMediaService,
  WallService,
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

async function main(): Promise<void> {
  const config = loadApiConfig();
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
