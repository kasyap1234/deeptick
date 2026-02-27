import { ChatOpenAI } from '@langchain/openai';
import { config, normalizeModelForOpenAICompatible } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

type ModelFactoryOptions = {
  maxRetries?: number;
  maxConcurrency?: number;
  maxTokens?: number;
  timeoutMs?: number;
  minRequestGapMs?: number;
  rateLimitRetries?: number;
  temperature?: number;
};

const modelCache = new Map<string, ChatOpenAI>();
const modelQueues = new Map<string, Promise<void>>();
const modelNextAllowedAt = new Map<string, number>();
const modelFallbackUntil = new Map<string, number>();

// Track per-model consecutive 429s to adaptively widen gaps after rate limits
const modelConsecutive429s = new Map<string, number>();
const MODEL_FALLBACK_WINDOW_MS = 5 * 60 * 1000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function getRateLimitFallbackModel(modelId: string): string | undefined {
  const lower = modelId.toLowerCase();
  if (lower === 'openai-gpt-oss-120b') return 'openai-gpt-oss-20b';
  if (lower === 'alibaba-qwen3-32b') return 'alibaba-qwen3-8b';
  if (lower === 'deepseek-r1-distill-llama-70b') return 'deepseek-r1-distill-llama-8b';
  return undefined;
}

function resolveEffectiveModel(modelId: string): string {
  // Use the configured model as-is. Rate-limit fallback to 20b happens
  // dynamically via getRateLimitFallbackModel when 429s are encountered.
  return modelId;
}

function withFallbackModelBody(init: RequestInit | undefined, fallbackModel: string): RequestInit | undefined {
  if (!init?.body || typeof init.body !== 'string') return init;

  try {
    const parsed = JSON.parse(init.body) as Record<string, unknown>;
    if (typeof parsed.model !== 'string') return init;

    return {
      ...init,
      body: JSON.stringify({
        ...parsed,
        model: fallbackModel,
      }),
    };
  } catch {
    return init;
  }
}

function parseRetryAfterMs(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;

  const seconds = Number(headerValue);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const timestamp = Date.parse(headerValue);
  if (!Number.isNaN(timestamp)) {
    return Math.max(0, timestamp - Date.now());
  }

  return undefined;
}

async function acquireModelSlot(modelId: string, minRequestGapMs: number): Promise<() => void> {
  const previous = modelQueues.get(modelId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });

  modelQueues.set(modelId, previous.then(() => current));
  await previous;

  // Adaptively widen the gap after repeated 429s for this model
  const consecutive429s = modelConsecutive429s.get(modelId) ?? 0;
  const adaptiveMultiplier = Math.min(4, 1 + consecutive429s * 0.5);
  const effectiveGap = Math.round(minRequestGapMs * adaptiveMultiplier);

  const waitMs = Math.max(0, (modelNextAllowedAt.get(modelId) ?? 0) - Date.now());
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  modelNextAllowedAt.set(modelId, Date.now() + effectiveGap);

  return () => {
    release();
  };
}

export function createDigitalOceanChatModel(
  modelId: string,
  options: ModelFactoryOptions = {},
): ChatOpenAI {
  if (!config.DO_GENAI_API_KEY) {
    throw new Error('DigitalOcean GenAI provider is required for research runs. Set DO_GENAI_API_KEY.');
  }

  const normalizedModel = normalizeModelForOpenAICompatible(modelId);
  const effectiveModel = resolveEffectiveModel(normalizedModel);
  const maxRetries = options.maxRetries ?? 1;
  const maxConcurrency = options.maxConcurrency ?? 1;
  const maxTokens = options.maxTokens ?? 768;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const minRequestGapMs = options.minRequestGapMs ?? 1500;
  const rateLimitRetries = options.rateLimitRetries ?? 4;
  const temperature = options.temperature ?? 0.1;
  const cacheKey = `${effectiveModel}|${maxRetries}|${maxConcurrency}|${maxTokens}|${timeoutMs}|${minRequestGapMs}|${rateLimitRetries}|${temperature}`;
  const cached = modelCache.get(cacheKey);
  if (cached) return cached;

  const model = new ChatOpenAI({
    model: effectiveModel,
    apiKey: config.DO_GENAI_API_KEY,
    maxRetries,
    maxConcurrency,
    maxTokens,
    temperature,
    timeout: timeoutMs,
    configuration: {
      baseURL: config.DO_GENAI_ENDPOINT,
      defaultHeaders: {
        Authorization: `Bearer ${config.DO_GENAI_API_KEY}`,
      },
      fetch: async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const release = await acquireModelSlot(effectiveModel, minRequestGapMs);
        const fallbackModel = getRateLimitFallbackModel(effectiveModel);
        let requestInit = init;
        let activeModel = effectiveModel;

        const fallbackWindowUntil = modelFallbackUntil.get(effectiveModel) ?? 0;
        if (fallbackModel && Date.now() < fallbackWindowUntil) {
          const updatedInit = withFallbackModelBody(requestInit, fallbackModel);
          if (updatedInit) {
            requestInit = updatedInit;
            activeModel = fallbackModel;
          }
        }

        try {
          for (let attempt = 0; attempt <= rateLimitRetries; attempt++) {
            const response = await fetch(input, requestInit);
            if (response.status !== 429) {
              // Success — decay the 429 counter for this model
              const prev = modelConsecutive429s.get(activeModel) ?? 0;
              if (prev > 0) modelConsecutive429s.set(activeModel, Math.max(0, prev - 1));
              if (activeModel === effectiveModel) {
                modelFallbackUntil.delete(effectiveModel);
              }
              return response;
            }
            if (attempt >= rateLimitRetries) {
              return response;
            }

            // Track consecutive 429s so acquireModelSlot widens future gaps
            modelConsecutive429s.set(activeModel, (modelConsecutive429s.get(activeModel) ?? 0) + 1);

            if (fallbackModel && activeModel !== fallbackModel) {
              const updatedInit = withFallbackModelBody(requestInit, fallbackModel);
              if (updatedInit) {
                requestInit = updatedInit;
                activeModel = fallbackModel;
                logger.warn(
                  { model: effectiveModel, fallbackModel },
                  'Switching to smaller model after 429 to reduce provider pressure',
                );
              }
            }

            const effectiveModel429s = modelConsecutive429s.get(effectiveModel) ?? 0;
            if (fallbackModel && effectiveModel429s >= 2) {
              const until = Date.now() + MODEL_FALLBACK_WINDOW_MS;
              modelFallbackUntil.set(effectiveModel, until);
              logger.warn(
                {
                  model: effectiveModel,
                  fallbackModel,
                  fallbackWindowMs: MODEL_FALLBACK_WINDOW_MS,
                  consecutive429s: effectiveModel429s,
                },
                'Temporarily pinning model to fallback after repeated 429s',
              );
            }

            const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
            const backoffMs = retryAfterMs ?? Math.min(60_000, 2_000 * (2 ** attempt));
            const jitterMs = Math.floor(Math.random() * 1_000);
            const waitMs = backoffMs + jitterMs;
            modelNextAllowedAt.set(activeModel, Date.now() + waitMs);
            logger.warn(
              { model: activeModel, attempt: attempt + 1, waitMs, consecutive429s: modelConsecutive429s.get(activeModel) },
              'Provider returned 429; applying model backoff before retry',
            );

            try {
              await response.arrayBuffer();
            } catch {
              // no-op
            }
            await sleep(waitMs);
          }

          return new Response('Rate limit exceeded.', { status: 429 });
        } finally {
          release();
        }
      },
    },
  });

  modelCache.set(cacheKey, model);
  return model;
}
