import { loadDatabaseConfig } from '@digital-autograph/config';
import { defineConfig } from 'drizzle-kit';

const { DATABASE_URL } = loadDatabaseConfig();

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: { url: DATABASE_URL },
});
