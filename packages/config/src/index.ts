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
    DISABLE_NEW_PAYMENTS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    DISABLE_FREE_CLAIMS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
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

const paymentSchema = baseSchema
  .extend({
    PAYMENT_PROVIDER: z.literal('yookassa'),
    PAYMENT_MODE: z.enum(['sandbox', 'live']),
    YOOKASSA_SHOP_ID: z.string().regex(/^[0-9]{1,20}$/),
    YOOKASSA_SECRET_KEY: z.string().min(1),
    PAYMENT_RETURN_URL: z.url(),
    WEB_ORIGIN: exactOrigin,
    PAYMENT_LIVE_ACTIVATION: z.literal('approved').optional(),
    PAYMENT_CREATOR_SHARE_BPS: z
      .string()
      .regex(/^(0|[1-9][0-9]{0,4})$/)
      .transform(Number)
      .pipe(z.number().int().min(0).max(10000)),
  })
  .superRefine((config, context) => {
    const url = new URL(config.PAYMENT_RETURN_URL);
    if (
      url.origin !== config.WEB_ORIGIN ||
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      (url.protocol !== 'https:' &&
        !(
          url.protocol === 'http:' &&
          ['local', 'test', 'development'].includes(config.APP_ENV) &&
          ['localhost', '127.0.0.1'].includes(url.hostname)
        ))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['PAYMENT_RETURN_URL'],
        message: 'must be a fixed safe URL on WEB_ORIGIN',
      });
    }
    if (
      config.PAYMENT_MODE === 'live' &&
      (config.APP_ENV !== 'production' ||
        config.PAYMENT_LIVE_ACTIVATION !== 'approved')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['PAYMENT_MODE'],
        message: 'live requires production and separate explicit approval',
      });
    }
    // Fail before even creating a payment if a live key is accidentally supplied.
    if (
      config.PAYMENT_MODE === 'sandbox' &&
      !config.YOOKASSA_SECRET_KEY.startsWith('test_')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['YOOKASSA_SECRET_KEY'],
        message:
          'sandbox requires a test key; provider test flag is also verified',
      });
    }
  });
export function loadPaymentConfig(environment = process.env) {
  const keys = [
    'PAYMENT_PROVIDER',
    'PAYMENT_MODE',
    'YOOKASSA_SHOP_ID',
    'YOOKASSA_SECRET_KEY',
    'PAYMENT_RETURN_URL',
    'PAYMENT_LIVE_ACTIVATION',
    'PAYMENT_CREATOR_SHARE_BPS',
  ];
  if (keys.every((key) => environment[key] === undefined)) return null; // no checkout routes until explicitly configured
  try {
    return paymentSchema.parse(environment);
  } catch {
    throw new Error('Invalid payment configuration (values redacted)');
  }
}

function loadNotificationTelegram<
  T extends { APP_ENV: string; WEB_ORIGIN: string },
>(schema: z.ZodType<T>, keys: string[], environment: NodeJS.ProcessEnv) {
  if (keys.every((key) => environment[key] === undefined)) return null;
  try {
    const result = schema.parse(environment);
    if (
      ['staging', 'production'].includes(result.APP_ENV) &&
      !result.WEB_ORIGIN.startsWith('https://')
    )
      throw new Error();
    return result;
  } catch {
    throw new Error(
      'Invalid notification Telegram configuration (values redacted)',
    );
  }
}

export function loadNotificationTelegramApiConfig(environment = process.env) {
  return loadNotificationTelegram(
    z.object({
      APP_ENV: appEnvironment,
      WEB_ORIGIN: exactOrigin,
      NOTIFICATION_TELEGRAM_BOT_USERNAME: z
        .string()
        .regex(/^[A-Za-z0-9_]{5,32}$/),
      NOTIFICATION_TELEGRAM_WEBHOOK_SECRET: z
        .string()
        .regex(/^[A-Za-z0-9_-]{32,256}$/),
    }),
    [
      'NOTIFICATION_TELEGRAM_BOT_USERNAME',
      'NOTIFICATION_TELEGRAM_WEBHOOK_SECRET',
    ],
    environment,
  );
}

export function loadNotificationTelegramWorkerConfig(
  environment = process.env,
) {
  return loadNotificationTelegram(
    z.object({
      APP_ENV: appEnvironment,
      WEB_ORIGIN: exactOrigin,
      NOTIFICATION_TELEGRAM_BOT_TOKEN: z
        .string()
        .regex(/^[0-9]+:[A-Za-z0-9_-]{20,}$/),
    }),
    ['NOTIFICATION_TELEGRAM_BOT_TOKEN'],
    environment,
  );
}

// Separate opt-in and operator approval. Neither credentials alone nor a public
// frontend flag can activate Yandex login. Disabled installations need no keys.
export function loadYandexAuthConfig(environment = process.env) {
  try {
    const gates = z
      .object({
        YANDEX_AUTH_ENABLED: z.enum(['true', 'false']).default('false'),
        YANDEX_AUTH_APPROVED: z.enum(['true', 'false']).default('false'),
      })
      .parse(environment);
    if (
      gates.YANDEX_AUTH_ENABLED !== 'true' ||
      gates.YANDEX_AUTH_APPROVED !== 'true'
    )
      return null;
    const config = z
      .object({
        APP_ENV: appEnvironment,
        WEB_ORIGIN: exactOrigin,
        GOOGLE_REDIRECT_URI: z.url(),
        YANDEX_CLIENT_ID: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
        YANDEX_CLIENT_SECRET: z.string().min(1).max(4096),
        YANDEX_REDIRECT_URI: z.url(),
      })
      .parse(environment);
    const callback = new URL(config.YANDEX_REDIRECT_URI);
    const web = new URL(config.WEB_ORIGIN);
    const local = ['local', 'test', 'development'].includes(config.APP_ENV);
    if (
      callback.href !== config.YANDEX_REDIRECT_URI ||
      callback.pathname !== '/auth/yandex/callback' ||
      callback.search ||
      callback.hash ||
      callback.username ||
      callback.password ||
      callback.origin !== new URL(config.GOOGLE_REDIRECT_URI).origin ||
      (callback.protocol !== 'https:' &&
        !(
          local &&
          callback.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(callback.hostname)
        )) ||
      (!local &&
        (web.protocol !== 'https:' ||
          !(
            callback.hostname === web.hostname ||
            callback.hostname === `api.${web.hostname}`
          )))
    )
      throw new Error();
    return {
      clientId: config.YANDEX_CLIENT_ID,
      clientSecret: config.YANDEX_CLIENT_SECRET,
      redirectUri: config.YANDEX_REDIRECT_URI,
    };
  } catch {
    throw new Error(
      'Invalid Yandex authentication configuration (values redacted)',
    );
  }
}

// Separate opt-in and operator approval. Neither credentials alone nor a public
// frontend flag can activate VkId login. Disabled installations need no keys.
export function loadVkIdAuthConfig(environment = process.env) {
  try {
    const gates = z
      .object({
        VK_AUTH_ENABLED: z.enum(['true', 'false']).default('false'),
        VK_AUTH_APPROVED: z.enum(['true', 'false']).default('false'),
      })
      .parse(environment);
    if (gates.VK_AUTH_ENABLED !== 'true' || gates.VK_AUTH_APPROVED !== 'true')
      return null;
    const config = z
      .object({
        APP_ENV: appEnvironment,
        WEB_ORIGIN: exactOrigin,
        GOOGLE_REDIRECT_URI: z.url(),
        VK_CLIENT_ID: z.string().regex(/^[1-9][0-9]{0,19}$/),
        VK_SERVICE_TOKEN: z.string().min(1).max(4096),
        VK_REDIRECT_URI: z.url(),
      })
      .parse(environment);
    const callback = new URL(config.VK_REDIRECT_URI);
    const web = new URL(config.WEB_ORIGIN);
    const local = ['local', 'test', 'development'].includes(config.APP_ENV);
    if (
      callback.href !== config.VK_REDIRECT_URI ||
      callback.pathname !== '/auth/vk-id/callback' ||
      callback.search ||
      callback.hash ||
      callback.username ||
      callback.password ||
      callback.origin !== new URL(config.GOOGLE_REDIRECT_URI).origin ||
      (callback.protocol !== 'https:' &&
        !(
          local &&
          callback.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(callback.hostname)
        )) ||
      (!local &&
        (web.protocol !== 'https:' ||
          !(
            callback.hostname === web.hostname ||
            callback.hostname === `api.${web.hostname}`
          )))
    )
      throw new Error();
    return {
      clientId: config.VK_CLIENT_ID,
      serviceToken: config.VK_SERVICE_TOKEN,
      redirectUri: config.VK_REDIRECT_URI,
    };
  } catch {
    throw new Error(
      'Invalid VkId authentication configuration (values redacted)',
    );
  }
}
