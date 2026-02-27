import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import * as schema from './schema.js';

const client = postgres(config.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
  ssl: {
    rejectUnauthorized: config.isProduction,
  },
});

export const db = drizzle(client, { schema });
logger.info('PostgreSQL database connection initialized');

export { client };

export function getDb() {
  return db;
}
