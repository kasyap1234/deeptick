import { z } from 'zod';
import dotenv from 'dotenv';
import pino from 'pino';

dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string().optional(),

  DO_GENAI_API_KEY: z.string().min(1),
  DO_GENAI_ENDPOINT: z.string().url().default('https://api.genai.digitalocean.com/v1'),

  GRADIENT_PROJECT_ID: z.string().min(1),
  GRADIENT_REGION: z.string().optional().default('tor1'),
  GRADIENT_MODEL_UUID: z.string().optional(),
  GRADIENT_AGENT_ENDPOINT: z.string().url().optional(),
  GRADIENT_AGENT_ACCESS_KEY: z.string().min(1).optional(),
  GRADIENT_KB_EMBEDDING_MODEL_URN: z.string().optional(),

  EXASEARCH_API_KEY: z.string().optional(),
  EXA_API_KEY: z.string().optional(),

  ALPHA_VANTAGE_API_KEY: z.string().optional(),

  DEEP_RESEARCH_ORCHESTRATOR_MODEL: z.string().optional().default('claude-sonnet-4-20250514'),
  DEEP_RESEARCH_SUBAGENT_MODEL: z.string().optional().default('claude-sonnet-4-20250514'),
  DEEP_RESEARCH_AUDITOR_MODEL: z.string().optional().default('claude-sonnet-4-20250514'),

  VECTOR_DB_MODE: z.enum(['database_url', 'local', 'managed']).optional().default('database_url'),
  LOCAL_DATABASE_URL: z.string().optional(),
  MANAGED_DATABASE_URL: z.string().optional(),

  LANGCHAIN_TRACING_V2: z.string().optional().default('false'),
  LANGCHAIN_API_KEY: z.string().optional(),
  LANGCHAIN_PROJECT: z.string().optional().default('deeptick-stock-researcher'),

  PORT: z.string().default('3001').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  CORS_ORIGINS: z.string().optional(),

  VECTOR_DIMENSION: z.string().default('1536').transform(Number),
  VECTOR_TABLE_NAME: z.string().default('stock_research_embeddings'),
  SIMILARITY_THRESHOLD: z.string().default('0.75').transform(Number).pipe(z.number().min(0).max(1)),
  MAX_RESULTS: z.string().default('10').transform(Number).pipe(z.number().int().positive()),
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

const isUsingGradient = Boolean(parsed.data.GRADIENT_PROJECT_ID && parsed.data.DO_GENAI_API_KEY);

const vectorDbUrl = (() => {
  if (isUsingGradient) {
    return null;
  }

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
  isVectorDbAvailable: vectorDbUrl !== null,
  isUsingGradient,
  isDevelopment: parsed.data.NODE_ENV === 'development',
  isProduction: parsed.data.NODE_ENV === 'production',
  corsOrigin: getCorsOrigins(),
  gradient: {
    projectId: parsed.data.GRADIENT_PROJECT_ID,
    region: parsed.data.GRADIENT_REGION,
    modelUuid: parsed.data.GRADIENT_MODEL_UUID,
    agentEndpoint: parsed.data.GRADIENT_AGENT_ENDPOINT,
    agentAccessKey: parsed.data.GRADIENT_AGENT_ACCESS_KEY,
    kbEmbeddingModelUrn: parsed.data.GRADIENT_KB_EMBEDDING_MODEL_URN,
  },
  similarityThreshold: parsed.data.SIMILARITY_THRESHOLD,
  maxResults: parsed.data.MAX_RESULTS,
};
