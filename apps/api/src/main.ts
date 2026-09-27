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
} from '@digital-autograph/db';
import { createGoogleOidcClient } from '@digital-autograph/integrations';
import { buildApi } from './app';
import {
  GoogleLoginService,
  googleLoginAttemptTtlSeconds,
} from './auth/google-login';

async function main(): Promise<void> {
  const config = loadApiConfig();
  const database = createDatabase(config.DATABASE_URL);
  const sessions = new SessionService(
    createPgSessionRepository(database.pool),
    config.SESSION_TTL_SECONDS,
  );
  const googleLogin = new GoogleLoginService(
    new OAuthAttemptService(
      createPgOAuthAttemptRepository(database.pool),
      googleLoginAttemptTtlSeconds,
    ),
    createGoogleOidcClient({
      clientId: config.GOOGLE_CLIENT_ID,
      clientSecret: config.GOOGLE_CLIENT_SECRET,
      redirectUri: config.GOOGLE_REDIRECT_URI,
    }),
    new IdentityService(createPgProviderIdentityRepository(database.pool)),
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
  );
  let closing = false;

  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    try {
      await app.close();
      await database.close();
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
