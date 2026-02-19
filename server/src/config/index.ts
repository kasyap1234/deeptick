import { z } from 'zod';
import dotenv from 'dotenv';
import pino from 'pino';

dotenv.config();

const envSchema = z.object({
  // Database - REQUIRED
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Auth Configuration
  BETTER_AUTH_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  TRUSTED_ORIGINS: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // AI/LLM Providers
  DO_GENAI_API_KEY: z.string().min(1),
  DO_GENAI_ENDPOINT: z.string().url().default('https://inference.do-ai.run/v1'),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  // Gradient AI Platform
  GRADIENT_PROJECT_ID: z.string().min(1),
  GRADIENT_REGION: z.string().optional().default('tor1'),
  GRADIENT_MODEL_UUID: z.string().optional(),
  GRADIENT_AGENT_ENDPOINT: z.string().url().optional(),
  GRADIENT_AGENT_ACCESS_KEY: z.string().min(1).optional(),
  GRADIENT_KB_EMBEDDING_MODEL_URN: z.string().optional(),
  
  // Guardrails Configuration
  GUARDRAIL_SENSITIVE_DATA: z.string().optional(),
  GUARDRAIL_JAILBREAK: z.string().optional(),
  GUARDRAIL_CONTENT_MODERATION: z.string().optional(),
  ENABLE_GUARDRAILS: z.string().optional().default('true'),

  // Search Providers
  EXASEARCH_API_KEY: z.string().optional(),
  EXA_API_KEY: z.string().optional(),

  // Stock Data Providers
  ALPHA_VANTAGE_API_KEY: z.string().optional(),

  // Deep Research Models
  DEEP_RESEARCH_ORCHESTRATOR_MODEL: z.string().optional().default('claude-sonnet-4-20250514'),
  DEEP_RESEARCH_SUBAGENT_MODEL: z.string().optional().default('claude-sonnet-4-20250514'),
  DEEP_RESEARCH_AUDITOR_MODEL: z.string().optional().default('claude-sonnet-4-20250514'),

  // LangSmith Tracing
  LANGCHAIN_TRACING_V2: z.string().optional().default('false'),
  LANGCHAIN_API_KEY: z.string().optional(),
  LANGCHAIN_PROJECT: z.string().optional().default('deeptick-stock-researcher'),

  // Server Configuration
  PORT: z.string().default('3001').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  CORS_ORIGINS: z.string().optional(),

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

const getCorsOrigins = (): string[] => {
  if (parsed.data.CORS_ORIGINS) {
    return parsed.data.CORS_ORIGINS.split(',').map((origin) => origin.trim());
  }
  if (parsed.data.TRUSTED_ORIGINS) {
    return parsed.data.TRUSTED_ORIGINS.split(',').map((origin) => origin.trim());
  }
  return parsed.data.NODE_ENV === 'production'
    ? ['https://deeptick.app']
    : ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:3001'];
};

export const config = {
  // Database
  DATABASE_URL: parsed.data.DATABASE_URL,

  // Auth
  auth: {
    url: parsed.data.BETTER_AUTH_URL,
    secret: parsed.data.BETTER_AUTH_SECRET,
    trustedOrigins: getCorsOrigins(),
    google: parsed.data.GOOGLE_CLIENT_ID && parsed.data.GOOGLE_CLIENT_SECRET
      ? {
          clientId: parsed.data.GOOGLE_CLIENT_ID,
          clientSecret: parsed.data.GOOGLE_CLIENT_SECRET,
        }
      : undefined,
  },

  // Environment
  isUsingGradient,
  isDevelopment: parsed.data.NODE_ENV === 'development',
  isProduction: parsed.data.NODE_ENV === 'production',
  corsOrigin: getCorsOrigins(),

  vectorDatabaseUrl: parsed.data.DATABASE_URL,
  isVectorDbAvailable: true,

  similarityThreshold: parsed.data.SIMILARITY_THRESHOLD,
  maxResults: parsed.data.MAX_RESULTS,

  // AI Providers
  DO_GENAI_API_KEY: parsed.data.DO_GENAI_API_KEY,
  DO_GENAI_ENDPOINT: parsed.data.DO_GENAI_ENDPOINT,
  openaiApiKey: parsed.data.OPENAI_API_KEY,
  anthropicApiKey: parsed.data.ANTHROPIC_API_KEY,

  // Gradient
  gradient: {
    projectId: parsed.data.GRADIENT_PROJECT_ID,
    region: parsed.data.GRADIENT_REGION,
    modelUuid: parsed.data.GRADIENT_MODEL_UUID,
    agentEndpoint: parsed.data.GRADIENT_AGENT_ENDPOINT,
    agentAccessKey: parsed.data.GRADIENT_AGENT_ACCESS_KEY,
    kbEmbeddingModelUrn: parsed.data.GRADIENT_KB_EMBEDDING_MODEL_URN,
  },

  // Guardrails
  guardrails: {
    enabled: parsed.data.ENABLE_GUARDRAILS === 'true',
    sensitiveDataId: parsed.data.GUARDRAIL_SENSITIVE_DATA,
    jailbreakId: parsed.data.GUARDRAIL_JAILBREAK,
    contentModerationId: parsed.data.GUARDRAIL_CONTENT_MODERATION,
  },

  // Search
  exaApiKey: parsed.data.EXASEARCH_API_KEY || parsed.data.EXA_API_KEY,

  // Stock Data
  alphaVantageApiKey: parsed.data.ALPHA_VANTAGE_API_KEY,

  // Deep Research Models
  deepResearch: {
    orchestratorModel: parsed.data.DEEP_RESEARCH_ORCHESTRATOR_MODEL,
    subagentModel: parsed.data.DEEP_RESEARCH_SUBAGENT_MODEL,
    auditorModel: parsed.data.DEEP_RESEARCH_AUDITOR_MODEL,
  },

  // LangSmith
  langchain: {
    tracing: parsed.data.LANGCHAIN_TRACING_V2 === 'true',
    apiKey: parsed.data.LANGCHAIN_API_KEY,
    project: parsed.data.LANGCHAIN_PROJECT,
  },

  // Server
  PORT: parsed.data.PORT,
  NODE_ENV: parsed.data.NODE_ENV,
  LOG_LEVEL: parsed.data.LOG_LEVEL,
};
