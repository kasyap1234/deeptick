import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

interface CacheEntry {
  prompt: string;
  response: string;
  tokens: number;
  timestamp: number;
  ttl: number;
}

interface PromptCacheStats {
  hits: number;
  misses: number;
  savings: number;
}

export class PromptCachingService {
  private cache: Map<string, CacheEntry> = new Map();
  private stats: PromptCacheStats = { hits: 0, misses: 0, savings: 0 };
  private defaultTtl = 5 * 60 * 1000;

  constructor(private cacheSize = 100, ttl = 5 * 60 * 1000) {
    this.defaultTtl = ttl;
  }

  private generateKey(prompt: string, context?: string): string {
    const normalizedPrompt = prompt.toLowerCase().trim().slice(0, 100);
    const normalizedContext = context?.toLowerCase().trim().slice(0, 50) || '';
    return `${normalizedPrompt}::${normalizedContext}`.slice(0, 200);
  }

  get(prompt: string, context?: string): string | null {
    const key = this.generateKey(prompt, context);
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    this.stats.savings += entry.tokens;
    logger.debug({ key: key.slice(0, 50), ttl: entry.ttl }, 'Cache hit');
    return entry.response;
  }

  set(prompt: string, response: string, tokens: number, context?: string, ttl?: number): void {
    if (this.cache.size >= this.cacheSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
        logger.debug('Cache full, evicted oldest entry');
      }
    }

    const key = this.generateKey(prompt, context);
    this.cache.set(key, {
      prompt,
      response,
      tokens,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTtl,
    });

    logger.debug({ key: key.slice(0, 50), tokens }, 'Cached prompt response');
  }

  clear(): void {
    this.cache.clear();
    logger.info('Prompt cache cleared');
  }

  getStats(): PromptCacheStats & { size: number; hitRate: number } {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? this.stats.hits / total : 0;
    return {
      ...this.stats,
      size: this.cache.size,
      hitRate: Math.round(hitRate * 100),
    };
  }

  invalidate(pattern: string): number {
    let count = 0;
    const lowerPattern = pattern.toLowerCase();
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.prompt.toLowerCase().includes(lowerPattern)) {
        this.cache.delete(key);
        count++;
      }
    }

    logger.info({ pattern, count }, 'Cache entries invalidated');
    return count;
  }
}

export class GradientPromptCacheService {
  private baseUrl = 'https://api.digitalocean.com/v2/gen-ai';

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.DO_GENAI_API_KEY}`,
    };
  }

  async createAgentWithCachedInstructions(
    name: string,
    instructions: string,
    modelId: string,
    guardrailIds?: string[]
  ): Promise<{ agentId: string; endpoint: string }> {
    if (!config.gradient.projectId) {
      throw new Error('GRADIENT_PROJECT_ID is required to create agents');
    }

    const payload: Record<string, unknown> = {
      name,
      instructions,
      model_id: modelId,
      project_id: config.gradient.projectId,
      region: config.gradient.region || 'tor1',
    };

    if (guardrailIds && guardrailIds.length > 0) {
      payload.guardrail_ids = guardrailIds;
    }

    logger.info({ name, modelId }, 'Creating Gradient Agent with cached instructions');

    const response = await fetch(`${this.baseUrl}/agents`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create agent: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      agent: { id: string; endpoint: string };
    };

    logger.info({ agentId: data.agent.id, endpoint: data.agent.endpoint }, 'Gradient Agent created');
    return { agentId: data.agent.id, endpoint: data.agent.endpoint };
  }

  async invokeWithCache(
    agentEndpoint: string,
    messages: Array<{ role: string; content: string }>,
    useCache = true
  ): Promise<{ response: string; cached: boolean; tokens: number }> {
    const response = await fetch(`${agentEndpoint}/api/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.DO_GENAI_API_KEY}`,
      },
      body: JSON.stringify({
        messages,
        max_tokens: 4000,
        ...(useCache && {
          cache_control: {
            type: 'ephemeral',
            ttl: '5m',
          },
        }),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Agent invocation failed: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
      usage: { total_tokens: number; cached_tokens?: number };
    };

    return {
      response: data.choices[0]?.message?.content || '',
      cached: Boolean(data.usage.cached_tokens),
      tokens: data.usage.total_tokens,
    };
  }

  async *streamWithCache(
    agentEndpoint: string,
    messages: Array<{ role: string; content: string }>,
    useCache = true
  ): AsyncGenerator<string> {
    const response = await fetch(`${agentEndpoint}/api/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.DO_GENAI_API_KEY}`,
      },
      body: JSON.stringify({
        messages,
        max_tokens: 4000,
        stream: true,
        ...(useCache && {
          cache_control: {
            type: 'ephemeral',
            ttl: '5m',
          },
        }),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Agent streaming failed: ${response.status} - ${error}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6);
          if (data === '[DONE]') return;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) yield content;
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }
  }
}

export const localPromptCache = new PromptCachingService(100, 5 * 60 * 1000);
export const gradientPromptCache = new GradientPromptCacheService();

// ============================================
// Semantic Prompt Cache using Vector Embeddings
// ============================================

import { createHash } from 'node:crypto';
import { eq, and, gt, lt, sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { promptCache } from '../db/schema.js';
import { embeddingService } from './embedding.service.js';

export interface SemanticCacheEntry {
  id: string;
  queryText: string;
  responseText: string;
  responseMetadata?: Record<string, unknown>;
  context?: Record<string, unknown>;
  focusAreas?: string[];
  hitCount: number;
  lastHitAt: Date | null;
  createdAt: Date;
  similarity: number;
}

export interface SemanticCacheSearchOptions {
  userId?: string;
  query: string;
  context?: Record<string, unknown>;
  focusAreas?: string[];
  similarityThreshold?: number;
  limit?: number;
}

export interface SemanticCacheStats {
  totalEntries: number;
  totalHits: number;
  hitRate: number;
  averageSimilarity: number;
}

const DEFAULT_SIMILARITY_THRESHOLD = 0.85;
const DEFAULT_CACHE_TTL_DAYS = 30;
const DEFAULT_LIMIT = 5;
const CACHE_STRICT_SIMILARITY = 0.9;
const CACHE_GENERAL_MAX_AGE_DAYS = 7;
const CACHE_FAST_MOVING_MAX_AGE_HOURS = 24;
const CACHE_HARD_MAX_AGE_DAYS = 14;
const CACHE_MIN_RECENT_SOURCE_RATIO = 0.35;
const CACHE_MIN_SOURCE_COUNT = 12;
const CACHE_MIN_DOMAIN_COUNT = 5;
const CACHE_MIN_COMPLETENESS_SCORE = 0.85;

function isFastMovingQuery(query: string): boolean {
  const normalizedQuery = query.toLowerCase();
  const fastMovingKeywords = [
    'today',
    'current',
    'latest',
    'now',
    'earnings',
    'guidance',
    'quarter',
    'price target',
    'upgrade',
    'downgrade',
  ];

  return fastMovingKeywords.some((keyword) => normalizedQuery.includes(keyword));
}

function calculateAgeHours(date: Date): number {
  return (Date.now() - date.getTime()) / (1000 * 60 * 60);
}

function extractNumber(
  metadata: Record<string, unknown> | undefined,
  key: string
): number | undefined {
  if (!metadata) {
    return undefined;
  }

  const value = metadata[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function evaluateCacheQuality(
  entry: SemanticCacheEntry
): { eligible: boolean; reason: string; freshnessScore: number } {
  const ageHours = calculateAgeHours(entry.createdAt);
  const ageDays = ageHours / 24;

  if (ageDays > CACHE_HARD_MAX_AGE_DAYS) {
    return { eligible: false, reason: 'hard_max_age_exceeded', freshnessScore: 0 };
  }

  const sourceCount = extractNumber(entry.responseMetadata, 'sourceCount');
  if (sourceCount !== undefined && sourceCount < CACHE_MIN_SOURCE_COUNT) {
    return { eligible: false, reason: 'source_count_below_minimum', freshnessScore: 0 };
  }

  const domainCount = extractNumber(entry.responseMetadata, 'domainCount');
  if (domainCount !== undefined && domainCount < CACHE_MIN_DOMAIN_COUNT) {
    return { eligible: false, reason: 'domain_count_below_minimum', freshnessScore: 0 };
  }

  const completenessScore = extractNumber(entry.responseMetadata, 'completenessScore');
  if (completenessScore !== undefined && completenessScore < CACHE_MIN_COMPLETENESS_SCORE) {
    return { eligible: false, reason: 'completeness_below_minimum', freshnessScore: 0 };
  }

  const recentSourceRatio = extractNumber(entry.responseMetadata, 'recentSourceRatio');
  if (recentSourceRatio !== undefined && recentSourceRatio < CACHE_MIN_RECENT_SOURCE_RATIO) {
    return { eligible: false, reason: 'recent_source_ratio_below_minimum', freshnessScore: 0 };
  }

  const decayScore = Math.max(0, 1 - ageDays / CACHE_HARD_MAX_AGE_DAYS);
  const recentBoost = recentSourceRatio !== undefined
    ? Math.min(0.25, Math.max(0, recentSourceRatio) * 0.25)
    : 0;
  const freshnessScore = Math.min(1, decayScore + recentBoost);

  return { eligible: true, reason: 'eligible', freshnessScore };
}

function parseMetadata(metadata: unknown): Record<string, unknown> | undefined {
  if (!metadata) {
    return undefined;
  }

  if (typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }

  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function toDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }

  return new Date(String(value));
}

function normalizeQueryForHash(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashQuery(query: string): string {
  const normalized = normalizeQueryForHash(query);
  return createHash('sha256').update(normalized).digest('hex');
}

export class SemanticPromptCacheService {
  private similarityThreshold: number;
  private cacheTTLDays: number;

  constructor() {
    this.similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD;
    this.cacheTTLDays = DEFAULT_CACHE_TTL_DAYS;
  }

  setSimilarityThreshold(threshold: number): void {
    this.similarityThreshold = threshold;
  }

  setCacheTTLDays(days: number): void {
    this.cacheTTLDays = days;
  }

  async searchCache(options: SemanticCacheSearchOptions): Promise<SemanticCacheEntry | null> {
    const {
      userId,
      query,
      context,
      focusAreas,
      similarityThreshold = this.similarityThreshold,
      limit = DEFAULT_LIMIT,
    } = options;

    try {
      const queryEmbedding = await embeddingService.embedQuery(query);
      
      if (!queryEmbedding || queryEmbedding.length === 0) {
        logger.warn('Failed to generate embedding for cache search');
        return null;
      }

      const db = getDb();
      const embeddingStr = `[${queryEmbedding.join(',')}]`;
      
      // Use native pgvector similarity search (cosine distance)
      // Lower distance = higher similarity
      const sql = `
        SELECT 
          id, "queryText", "responseText", "responseMetadata", 
          "context", "focusAreas", "hitCount", "lastHitAt", "createdAt",
          1 - (embedding <=> $1::vector) as similarity
        FROM prompt_cache
        WHERE ($2::text IS NULL OR "userId" = $2)
          AND "expiresAt" > NOW()
        ORDER BY embedding <=> $1::vector
        LIMIT $3
      `;
      
      const results = await (db as any).execute(
        sql,
        [embeddingStr, userId || null, limit * 4]
      ) as any[];

      let bestMatch: SemanticCacheEntry | null = null;
      let bestSimilarity = 0;
      let bestEffectiveScore = -1;
      const fastMovingQuery = isFastMovingQuery(query);

      for (const entry of results) {
        const similarity = entry.similarity || 0;

        if (similarity < similarityThreshold) {
          logger.debug(
            { cacheId: entry.id, similarity, similarityThreshold },
            'Semantic cache candidate rejected: similarity below threshold'
          );
          continue;
        }

        const candidate: SemanticCacheEntry = {
          id: entry.id,
          queryText: entry.queryText,
          responseText: entry.responseText,
          responseMetadata: parseMetadata(entry.responseMetadata),
          context: entry.context,
          focusAreas: entry.focusAreas,
          hitCount: entry.hitCount,
          lastHitAt: entry.lastHitAt ? toDate(entry.lastHitAt) : null,
          createdAt: toDate(entry.createdAt),
          similarity,
        };

        let contextMatch = true;
        let focusAreasMatch = true;

        if (context && candidate.context) {
          const entryContextKeys = Object.keys(candidate.context);
          const searchContextKeys = Object.keys(context);
          contextMatch = entryContextKeys.some((key) =>
            searchContextKeys.includes(key) &&
            candidate.context?.[key] === context[key]
          );
        }

        if (focusAreas && candidate.focusAreas) {
          const searchAreas = new Set(focusAreas.map((a) => a.toLowerCase()));
          const entryAreas = new Set(candidate.focusAreas.map((a: string) => a.toLowerCase()));
          const intersection = [...searchAreas].filter((a) => entryAreas.has(a));
          focusAreasMatch =
            intersection.length >= Math.min(focusAreas.length, candidate.focusAreas.length) * 0.5;
        }

        if (!contextMatch || !focusAreasMatch) {
          logger.debug(
            {
              cacheId: candidate.id,
              contextMatch,
              focusAreasMatch,
            },
            'Semantic cache candidate rejected: context/focus mismatch'
          );
          continue;
        }

        const ageHours = calculateAgeHours(candidate.createdAt);
        const ageDays = ageHours / 24;

        if (fastMovingQuery && ageHours > CACHE_FAST_MOVING_MAX_AGE_HOURS) {
          logger.info(
            {
              cacheId: candidate.id,
              ageHours,
              maxAgeHours: CACHE_FAST_MOVING_MAX_AGE_HOURS,
            },
            'Semantic cache candidate rejected: fast-moving freshness window exceeded'
          );
          continue;
        }

        const quality = evaluateCacheQuality(candidate);
        if (!quality.eligible) {
          logger.info(
            {
              cacheId: candidate.id,
              reason: quality.reason,
              ageDays,
            },
            'Semantic cache candidate rejected: quality gate failed'
          );
          continue;
        }

        if (ageDays > CACHE_GENERAL_MAX_AGE_DAYS && similarity < CACHE_STRICT_SIMILARITY) {
          logger.debug(
            {
              cacheId: candidate.id,
              ageDays,
              similarity,
              strictSimilarity: CACHE_STRICT_SIMILARITY,
            },
            'Semantic cache candidate rejected: general freshness window exceeded'
          );
          continue;
        }

        const effectiveScore = similarity * 0.7 + quality.freshnessScore * 0.3;

        if (effectiveScore > bestEffectiveScore) {
          bestEffectiveScore = effectiveScore;
          bestSimilarity = similarity;
          bestMatch = candidate;
        }
      }

      if (bestMatch) {
        await this.recordHit(bestMatch.id);
        logger.info({ 
          query: query.substring(0, 50), 
          similarity: bestSimilarity,
          effectiveScore: bestEffectiveScore,
        }, 'Semantic cache hit (pgvector)');
      }

      return bestMatch;
    } catch (error) {
      logger.error({ error }, 'Error searching semantic cache');
      return null;
    }
  }

  async addToCache(options: {
    userId?: string;
    query: string;
    response: string;
    responseMetadata?: Record<string, unknown>;
    context?: Record<string, unknown>;
    focusAreas?: string[];
    ttlDays?: number;
  }): Promise<string | null> {
    const {
      userId,
      query,
      response,
      responseMetadata,
      context,
      focusAreas,
      ttlDays = this.cacheTTLDays,
    } = options;

    const sourceCount = extractNumber(responseMetadata, 'sourceCount');
    const domainCount = extractNumber(responseMetadata, 'domainCount');
    const completenessScore = extractNumber(responseMetadata, 'completenessScore');
    const recentSourceRatio = extractNumber(responseMetadata, 'recentSourceRatio');

    if (
      (sourceCount !== undefined && sourceCount < CACHE_MIN_SOURCE_COUNT) ||
      (domainCount !== undefined && domainCount < CACHE_MIN_DOMAIN_COUNT) ||
      (completenessScore !== undefined && completenessScore < CACHE_MIN_COMPLETENESS_SCORE) ||
      (recentSourceRatio !== undefined && recentSourceRatio < CACHE_MIN_RECENT_SOURCE_RATIO)
    ) {
      logger.info(
        {
          sourceCount,
          domainCount,
          completenessScore,
          recentSourceRatio,
        },
        'Skipping semantic cache write due to quality thresholds',
      );
      return null;
    }

    try {
      const queryEmbedding = await embeddingService.embedQuery(query);
      
      if (!queryEmbedding || queryEmbedding.length === 0) {
        logger.warn('Failed to generate embedding for cache, skipping');
        return null;
      }

      const db = getDb();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + ttlDays);

      // Store embedding as array for pgvector
      const result = await db.insert(promptCache).values({
        userId: userId ?? null,
        queryHash: hashQuery(query),
        queryText: query,
        embedding: queryEmbedding,
        responseText: response,
        responseMetadata: responseMetadata ?? null,
        context: context ?? null,
        focusAreas: focusAreas ?? null,
        hitCount: 1,
        lastHitAt: new Date(),
        expiresAt,
      }).returning({ id: promptCache.id });

      logger.info({ query: query.substring(0, 50) }, 'Added to semantic cache (pgvector)');
      
      return result[0]!.id;
    } catch (error) {
      logger.error({ error }, 'Error adding to semantic cache');
      return null;
    }
  }

  private async recordHit(cacheId: string): Promise<void> {
    const db = getDb();
    
    await db
      .update(promptCache)
      .set({
        hitCount: sql`${promptCache.hitCount} + 1`,
        lastHitAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(promptCache.id, cacheId));
  }

  async invalidateCache(cacheId: string): Promise<void> {
    const db = getDb();
    
    await db
      .update(promptCache)
      .set({
        expiresAt: new Date(),
      })
      .where(eq(promptCache.id, cacheId));
  }

  async clearExpiredCache(): Promise<number> {
    const db = getDb();
    
    const result = await db
      .delete(promptCache)
      .where(lt(promptCache.expiresAt, new Date()));
    
    logger.info('Cleared expired semantic cache entries');
    return result.length;
  }

  async getCacheStats(userId?: string): Promise<SemanticCacheStats> {
    const db = getDb();
    
    const results = await db
      .select()
      .from(promptCache)
      .where(
        and(
          userId ? eq(promptCache.userId, userId) : undefined,
          gt(promptCache.expiresAt, new Date())
        )
      );

    const totalEntries = results.length;
    const totalHits = results.reduce((sum, entry) => sum + entry.hitCount, 0);
    const hitRate = totalEntries > 0 ? totalHits / totalEntries : 0;

    return {
      totalEntries,
      totalHits,
      hitRate,
      averageSimilarity: 0,
    };
  }
}

export const semanticPromptCache = new SemanticPromptCacheService();
