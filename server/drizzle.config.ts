import type { Config } from 'drizzle-kit';
import { defineConfig } from 'drizzle-kit';

const dbUrl = process.env.DATABASE_URL || '';
const dbUrlWithSsl = dbUrl.includes('sslmode') 
  ? dbUrl 
  : `${dbUrl}?sslmode=require`;

export default defineConfig({
  schema: ['./src/db/schema.ts', './src/auth-schema.ts'],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: dbUrlWithSsl,
  },
  verbose: true,
  strict: true,
});
