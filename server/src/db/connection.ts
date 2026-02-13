import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import * as schema from './schema.js';

// Connection pool for Drizzle ORM
const connectionString = config.vectorDatabaseUrl;

let client: postgres.Sql | null = null;
let db: ReturnType<typeof drizzle> | null = null;

if (connectionString) {
  client = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  db = drizzle(client, { schema });
  logger.info('Vector database connection initialized');
} else {
  logger.info('Vector database not configured - running in Gradient-only mode');
}

export { db, client };
