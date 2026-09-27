import { z, ZodError } from 'zod';

const appEnvironment = z.enum([
  'local',
  'test',
  'development',
  'staging',
  'production',
]);

const baseSchema = z.object({
  APP_ENV: appEnvironment,
});

const databaseSchema = baseSchema.extend({
  DATABASE_URL: z
    .url()
    .refine(
      (value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol),
      { message: 'must use a PostgreSQL URL' },
    ),
});

const exactOrigin = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      url.origin === value &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}, 'must be an exact HTTP(S) origin');

const apiSchema = databaseSchema
  .extend({
    API_HOST: z.string().min(1),
    API_PORT: z.coerce.number().int().min(1).max(65535),
    SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(2_592_000),
    TRUSTED_WEB_ORIGINS: z
      .string()
      .min(1)
      .transform((value) => value.split(',').map((origin) => origin.trim()))
      .pipe(z.array(exactOrigin).min(1)),
    WEB_ORIGIN: exactOrigin,
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    GOOGLE_REDIRECT_URI: z.url().refine((value) => {
      try {
        const url = new URL(value);
        return (
          ['http:', 'https:'].includes(url.protocol) &&
          url.pathname === '/auth/google/callback' &&
          !url.search &&
          !url.hash &&
          !url.username &&
          !url.password
        );
      } catch {
        return false;
      }
    }, 'must be an absolute HTTP(S) /auth/google/callback URL'),
    TELEGRAM_CLIENT_ID: z.string().min(1),
    TELEGRAM_CLIENT_SECRET: z.string().min(1),
    TELEGRAM_REDIRECT_URI: z.url().refine((value) => {
      try {
        const url = new URL(value);
        return (
          ['http:', 'https:'].includes(url.protocol) &&
          url.pathname === '/auth/telegram/callback' &&
          !url.search &&
          !url.hash &&
          !url.username &&
          !url.password
        );
      } catch {
        return false;
      }
    }, 'must be an absolute HTTP(S) /auth/telegram/callback URL'),
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1),
    S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    UPLOAD_URL_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(600)
      .default(300),
    PREVIEW_URL_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(300)
      .default(120),
  })
  .superRefine((config, context) => {
    if (
      Boolean(config.S3_ACCESS_KEY_ID) !== Boolean(config.S3_SECRET_ACCESS_KEY)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['S3_ACCESS_KEY_ID'],
        message: 'S3 access key and secret must be supplied together',
      });
    }
    if (config.S3_ENDPOINT) {
      const endpoint = new URL(config.S3_ENDPOINT);
      if (
        !['http:', 'https:'].includes(endpoint.protocol) ||
        endpoint.username ||
        endpoint.password
      ) {
        context.addIssue({
          code: 'custom',
          path: ['S3_ENDPOINT'],
          message: 'must be an HTTP(S) URL without credentials',
        });
      }
      if (
        ['production', 'staging'].includes(config.APP_ENV) &&
        endpoint.protocol !== 'https:'
      ) {
        context.addIssue({
          code: 'custom',
          path: ['S3_ENDPOINT'],
          message: 'must use HTTPS outside local development',
        });
      }
    }
    if (!config.TRUSTED_WEB_ORIGINS.includes(config.WEB_ORIGIN)) {
      context.addIssue({
        code: 'custom',
        path: ['WEB_ORIGIN'],
        message: 'must be included in TRUSTED_WEB_ORIGINS',
      });
    }
    const redirect = new URL(config.GOOGLE_REDIRECT_URI);
    const telegramRedirect = new URL(config.TELEGRAM_REDIRECT_URI);
    const webHost = new URL(config.WEB_ORIGIN).hostname;
    if (
      ['local', 'test', 'development'].includes(config.APP_ENV) &&
      redirect.protocol === 'http:' &&
      (!['localhost', '127.0.0.1'].includes(redirect.hostname) ||
        !['localhost', '127.0.0.1'].includes(webHost))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['GOOGLE_REDIRECT_URI'],
        message: 'HTTP callback must use localhost or 127.0.0.1',
      });
    }
    if (
      ['local', 'test', 'development'].includes(config.APP_ENV) &&
      telegramRedirect.protocol === 'http:' &&
      (!['localhost', '127.0.0.1'].includes(telegramRedirect.hostname) ||
        !['localhost', '127.0.0.1'].includes(webHost))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['TELEGRAM_REDIRECT_URI'],
        message: 'HTTP callback must use localhost or 127.0.0.1',
      });
    }
    if (!['production', 'staging'].includes(config.APP_ENV)) return;
    if (
      config.TRUSTED_WEB_ORIGINS.some(
        (origin) => !origin.startsWith('https://'),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['TRUSTED_WEB_ORIGINS'],
        message: 'must use HTTPS origins in staging and production',
      });
    }
    if (
      !config.WEB_ORIGIN.startsWith('https://') ||
      !config.GOOGLE_REDIRECT_URI.startsWith('https://')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['GOOGLE_REDIRECT_URI'],
        message:
          'web origin and Google callback must use HTTPS in staging and production',
      });
    }
    if (!config.TELEGRAM_REDIRECT_URI.startsWith('https://')) {
      context.addIssue({
        code: 'custom',
        path: ['TELEGRAM_REDIRECT_URI'],
        message: 'Telegram callback must use HTTPS in staging and production',
      });
    }
  });

const workerSchema = databaseSchema
  .extend({
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1),
    S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    WORKER_POLL_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(250)
      .max(10000)
      .default(1000),
    WORKER_LEASE_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
    UPLOAD_CLEANUP_GRACE_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(86400)
      .default(600),
  })
  .superRefine((config, context) => {
    if (
      Boolean(config.S3_ACCESS_KEY_ID) !== Boolean(config.S3_SECRET_ACCESS_KEY)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['S3_ACCESS_KEY_ID'],
        message: 'S3 access key and secret must be supplied together',
      });
    }
    if (config.S3_ENDPOINT) {
      const endpoint = new URL(config.S3_ENDPOINT);
      if (
        !['http:', 'https:'].includes(endpoint.protocol) ||
        endpoint.username ||
        endpoint.password ||
        (['production', 'staging'].includes(config.APP_ENV) &&
          endpoint.protocol !== 'https:')
      ) {
        context.addIssue({
          code: 'custom',
          path: ['S3_ENDPOINT'],
          message:
            'must use a safe HTTP(S) endpoint, HTTPS outside local development',
        });
      }
    }
  });

const webSchema = baseSchema.extend({
  API_INTERNAL_URL: z
    .url()
    .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
      message: 'must use an HTTP URL',
    }),
  API_PUBLIC_ORIGIN: exactOrigin,
});

function parseConfig<T extends z.ZodType>(
  schema: T,
  environment: NodeJS.ProcessEnv,
): z.infer<T> {
  try {
    return schema.parse(environment);
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    const details = error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid application configuration: ${details}`, {
      cause: error,
    });
  }
}

export const loadDatabaseConfig = (environment = process.env) =>
  parseConfig(databaseSchema, environment);

export const loadApiConfig = (environment = process.env) =>
  parseConfig(apiSchema, environment);

export const loadWorkerConfig = (environment = process.env) =>
  parseConfig(workerSchema, environment);

export const loadWebConfig = (environment = process.env) => {
  const config = parseConfig(webSchema, environment);
  if (
    ['production', 'staging'].includes(config.APP_ENV) &&
    !config.API_PUBLIC_ORIGIN.startsWith('https://')
  ) {
    throw new Error(
      'Invalid application configuration: API_PUBLIC_ORIGIN must use HTTPS',
    );
  }
  return config;
};

export type AppEnvironment = z.infer<typeof appEnvironment>;
