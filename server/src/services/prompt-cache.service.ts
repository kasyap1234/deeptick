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

  constructor(private cacheSize = 100, private ttl = 5 * 60 * 1000) {
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
    const lastMessage = messages[messages.length - 1];
    
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
import { eq, and, gt, lt, desc } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { promptCache } from '../db/schema.js';
import { embeddingService } from './embedding.service.js';
import { logger } from '../utils/logger.js';

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

function embeddingToString(embedding: number[]): string {
  return JSON.stringify(embedding);
}

function stringToEmbedding(str: string): number[] {
  try {
    return JSON.parse(str);
  } catch {
    return [];
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
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
      
      if (!queryEmbedding) {
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
      
      const results = await db.execute(
        sql,
        [embeddingStr, userId || null, limit * 2]
      ) as any[];

      let bestMatch: SemanticCacheEntry | null = null;
      let bestSimilarity = 0;

      for (const entry of results) {
        const similarity = entry.similarity || 0;
        
        if (similarity >= similarityThreshold && similarity > bestSimilarity) {
          let contextMatch = true;
          let focusAreasMatch = true;

          if (context && entry.context) {
            const entryContextKeys = Object.keys(entry.context);
            const searchContextKeys = Object.keys(context);
            contextMatch = entryContextKeys.some(key => 
              searchContextKeys.includes(key) && 
              entry.context[key] === context[key]
            );
          }

          if (focusAreas && entry.focusAreas) {
            const searchAreas = new Set(focusAreas.map(a => a.toLowerCase()));
            const entryAreas = new Set(entry.focusAreas.map((a: string) => a.toLowerCase()));
            const intersection = [...searchAreas].filter(a => entryAreas.has(a));
            focusAreasMatch = intersection.length >= Math.min(focusAreas.length, entry.focusAreas.length) * 0.5;
          }

          if (contextMatch && focusAreasMatch) {
            bestSimilarity = similarity;
            bestMatch = {
              id: entry.id,
              queryText: entry.queryText,
              responseText: entry.responseText,
              responseMetadata: entry.responseMetadata,
              context: entry.context,
              focusAreas: entry.focusAreas,
              hitCount: entry.hitCount,
              lastHitAt: entry.lastHitAt,
              createdAt: entry.createdAt,
              similarity,
            };
          }
        }
      }

      if (bestMatch) {
        await this.recordHit(bestMatch.id);
        logger.info({ 
          query: query.substring(0, 50), 
          similarity: bestSimilarity 
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

    try {
      const queryEmbedding = await embeddingService.embedQuery(query);
      
      if (!queryEmbedding) {
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
        hitCount: promptCache.hitCount + 1,
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
