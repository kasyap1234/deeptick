import { z } from 'zod';
import dotenv from 'dotenv';
import pino from 'pino';

dotenv.config();

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url().optional(),

  // AI/LLM Providers
  DO_GENAI_API_KEY: z.string().min(1),
  DO_GENAI_ENDPOINT: z.string().url(),

  // Search (primary doc-aligned key + legacy fallback)
  EXASEARCH_API_KEY: z.string().optional(),
  EXA_API_KEY: z.string().optional(),

  // Stock Data Providers
  ALPHA_VANTAGE_API_KEY: z.string().optional(),

  // Deep research models
  DEEP_RESEARCH_ORCHESTRATOR_MODEL: z.string().optional().default('claude-sonnet-4-20250514'),
  DEEP_RESEARCH_SUBAGENT_MODEL: z.string().optional().default('claude-sonnet-4-20250514'),
  DEEP_RESEARCH_AUDITOR_MODEL: z.string().optional().default('claude-sonnet-4-20250514'),

  // Vector DB target selection
  VECTOR_DB_MODE: z.enum(['database_url', 'local', 'managed']).optional().default('database_url'),
  LOCAL_DATABASE_URL: z.string().url().optional(),
  MANAGED_DATABASE_URL: z.string().url().optional(),

  // Optional: LangSmith Tracing
  LANGCHAIN_TRACING_V2: z.string().optional().default('false'),
  LANGCHAIN_API_KEY: z.string().optional(),
  LANGCHAIN_PROJECT: z.string().optional().default('deeptick-stock-researcher'),

  // Server
  PORT: z.string().default('3001').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  CORS_ORIGINS: z.string().optional(),

  // Vector Store
  VECTOR_DIMENSION: z.string().default('1536').transform(Number),
  VECTOR_TABLE_NAME: z.string().default('stock_research_embeddings'),
});

const envLogger = pino({ level: 'error' });
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  envLogger.error({ errors: parsed.error.format() }, 'Environment validation failed');
  process.exit(1);
}

const hasExaKey = Boolean(parsed.data.EXASEARCH_API_KEY || parsed.data.EXA_API_KEY);
if (!hasExaKey) {
  envLogger.error('Environment validation failed: EXASEARCH_API_KEY (preferred) or EXA_API_KEY must be set.');
  process.exit(1);
}

const vectorDbUrl = (() => {
  if (parsed.data.VECTOR_DB_MODE === 'local') {
    if (!parsed.data.LOCAL_DATABASE_URL) {
      envLogger.error('Environment validation failed: LOCAL_DATABASE_URL must be set when VECTOR_DB_MODE=local.');
      process.exit(1);
    }
    return parsed.data.LOCAL_DATABASE_URL;
  }

  if (parsed.data.VECTOR_DB_MODE === 'managed') {
    if (!parsed.data.MANAGED_DATABASE_URL) {
      envLogger.error('Environment validation failed: MANAGED_DATABASE_URL must be set when VECTOR_DB_MODE=managed.');
      process.exit(1);
    }
    return parsed.data.MANAGED_DATABASE_URL;
  }

  if (!parsed.data.DATABASE_URL) {
    envLogger.error('Environment validation failed: DATABASE_URL must be set when VECTOR_DB_MODE=database_url.');
    process.exit(1);
  }

  return parsed.data.DATABASE_URL;
})();

const getCorsOrigins = (): string[] => {
  if (parsed.data.CORS_ORIGINS) {
    return parsed.data.CORS_ORIGINS.split(',').map((origin) => origin.trim());
  }
  return parsed.data.NODE_ENV === 'production'
    ? ['https://deeptick.app']
    : ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:3001'];
};

export const config = {
  ...parsed.data,
  vectorDatabaseUrl: vectorDbUrl,
  isDevelopment: parsed.data.NODE_ENV === 'development',
  isProduction: parsed.data.NODE_ENV === 'production',
  corsOrigin: getCorsOrigins(),
};
