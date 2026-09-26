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

const apiSchema = databaseSchema.extend({
  API_HOST: z.string().min(1),
  API_PORT: z.coerce.number().int().min(1).max(65535),
});

const workerSchema = databaseSchema;

const webSchema = baseSchema.extend({
  API_INTERNAL_URL: z
    .url()
    .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
      message: 'must use an HTTP URL',
    }),
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

export const loadWebConfig = (environment = process.env) =>
  parseConfig(webSchema, environment);

export type AppEnvironment = z.infer<typeof appEnvironment>;
