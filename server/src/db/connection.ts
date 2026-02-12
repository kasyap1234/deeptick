import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config/index.js';
import * as schema from './schema.js';

// Connection pool for Drizzle ORM
const connectionString = config.vectorDatabaseUrl;

// Create postgres client with connection pooling
const client = postgres(connectionString, {
  max: 10, // Connection pool size
  idle_timeout: 20, // Idle timeout in seconds
  connect_timeout: 10, // Connection timeout in seconds
  prepare: false, // Disable prepared statements for compatibility
});

// Initialize Drizzle ORM with schema
export const db = drizzle(client, { schema });

// Export raw client for raw queries if needed
export { client };
