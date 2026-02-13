import { eq, sql, desc, cosineDistance, gt, and } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { researchJobs, researchEmbeddings, messages } from '../db/schema.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { InstitutionalResearchReport } from '../types/research.types.js';

export interface SimilaritySearchResult {
  id: string;
  content: string;
  source: string | null;
  sourceType: string | null;
  metadata: unknown;
  similarity: number;
  jobId: string;
}

export interface CachedQueryResult {
  jobId: string;
  query: string;
  result: InstitutionalResearchReport;
  similarity: number;
  createdAt: Date;
}

export interface VectorStoreConfig {
  similarityThreshold: number;
  maxResults: number;
}

export class VectorStoreService {
  private config: VectorStoreConfig;

  constructor(config: Partial<VectorStoreConfig> = {}) {
    this.config = {
      similarityThreshold: config.similarityThreshold ?? 0.85,
      maxResults: config.maxResults ?? 5,
    };
  }

  private isAvailable(): boolean {
    return config.isVectorDbAvailable;
  }

  async findSimilarQueries(
    queryEmbedding: number[],
    threshold: number = this.config.similarityThreshold
  ): Promise<CachedQueryResult[]> {
    if (!this.isAvailable()) {
      logger.debug('Vector DB not available, skipping query cache check');
      return [];
    }

    const similarity = sql<number>`1 - (${cosineDistance(researchJobs.queryEmbedding, queryEmbedding)})`;

    const results = await db
      .select({
        jobId: researchJobs.id,
        query: researchJobs.query,
        result: researchJobs.result,
        similarity,
        createdAt: researchJobs.createdAt,
      })
      .from(researchJobs)
      .where(gt(similarity, threshold))
      .orderBy(desc(similarity))
      .limit(this.config.maxResults);

    return results
      .filter((r): r is typeof r & { result: NonNullable<typeof r.result> } => r.result !== null)
      .map((r) => ({
        jobId: r.jobId,
        query: r.query,
        result: r.result as InstitutionalResearchReport,
        similarity: r.similarity,
        createdAt: r.createdAt,
      }));
  }

  async searchSimilarContent(
    queryEmbedding: number[],
    sourceTypes?: string[],
    threshold: number = 0.75
  ): Promise<SimilaritySearchResult[]> {
    if (!this.isAvailable()) {
      logger.debug('Vector DB not available, skipping content search');
      return [];
    }

    const similarity = sql<number>`1 - (${cosineDistance(researchEmbeddings.contentEmbedding, queryEmbedding)})`;

    const results = await db
      .select({
        id: researchEmbeddings.id,
        content: researchEmbeddings.content,
        source: researchEmbeddings.source,
        sourceType: researchEmbeddings.sourceType,
        metadata: researchEmbeddings.metadata,
        similarity,
        jobId: researchEmbeddings.jobId,
      })
      .from(researchEmbeddings)
      .where(
        sourceTypes && sourceTypes.length > 0
          ? and(
              gt(similarity, threshold),
              sql`${researchEmbeddings.sourceType} = ANY(${sourceTypes})`
            )
          : gt(similarity, threshold)
      )
      .orderBy(desc(similarity))
      .limit(this.config.maxResults);

    return results.map((r) => ({
      id: r.id,
      content: r.content,
      source: r.source,
      sourceType: r.sourceType,
      metadata: r.metadata,
      similarity: r.similarity,
      jobId: r.jobId,
    }));
  }

  async storeQueryEmbedding(
    jobId: string,
    _query: string,
    embedding: number[]
  ): Promise<void> {
    if (!this.isAvailable()) {
      logger.debug('Vector DB not available, skipping query embedding storage');
      return;
    }

    await db
      .update(researchJobs)
      .set({
        queryEmbedding: embedding,
        updatedAt: new Date(),
      })
      .where(eq(researchJobs.id, jobId));
  }

  async storeContentEmbeddings(
    jobId: string,
    chunks: Array<{
      content: string;
      embedding: number[];
      source?: string;
      sourceType?: 'web_search' | 'report_section' | 'chat_message';
      metadata?: Record<string, unknown>;
    }>
  ): Promise<void> {
    if (!this.isAvailable()) {
      logger.debug('Vector DB not available, skipping content embeddings storage');
      return;
    }

    if (chunks.length === 0) return;

    const embeddingsToInsert = chunks.map((chunk) => ({
      jobId,
      content: chunk.content,
      contentEmbedding: chunk.embedding,
      source: chunk.source ?? null,
      sourceType: chunk.sourceType ?? 'report_section' as const,
      metadata: chunk.metadata ?? {},
    }));

    await db.insert(researchEmbeddings).values(embeddingsToInsert);
  }

  async storeMessageEmbedding(
    messageId: string,
    embedding: number[]
  ): Promise<void> {
    if (!this.isAvailable()) {
      logger.debug('Vector DB not available, skipping message embedding storage');
      return;
    }

    await db
      .update(messages)
      .set({
        contentEmbedding: embedding,
      })
      .where(eq(messages.id, messageId));
  }

  async getRelatedContent(
    jobId: string,
    queryEmbedding: number[],
    limit: number = 10
  ): Promise<SimilaritySearchResult[]> {
    if (!this.isAvailable()) {
      logger.debug('Vector DB not available, skipping related content retrieval');
      return [];
    }

    const similarity = sql<number>`1 - (${cosineDistance(researchEmbeddings.contentEmbedding, queryEmbedding)})`;

    const results = await db
      .select({
        id: researchEmbeddings.id,
        content: researchEmbeddings.content,
        source: researchEmbeddings.source,
        sourceType: researchEmbeddings.sourceType,
        metadata: researchEmbeddings.metadata,
        similarity,
        jobId: researchEmbeddings.jobId,
      })
      .from(researchEmbeddings)
      .where(eq(researchEmbeddings.jobId, jobId))
      .orderBy(desc(similarity))
      .limit(limit);

    return results.map((r) => ({
      id: r.id,
      content: r.content,
      source: r.source,
      sourceType: r.sourceType,
      metadata: r.metadata,
      similarity: r.similarity,
      jobId: r.jobId,
    }));
  }

  async deleteJobEmbeddings(jobId: string): Promise<void> {
    if (!this.isAvailable()) {
      logger.debug('Vector DB not available, skipping job embeddings deletion');
      return;
    }
    await db.delete(researchEmbeddings).where(eq(researchEmbeddings.jobId, jobId));
  }

  async cleanupOldEmbeddings(daysToKeep: number = 30): Promise<number> {
    if (!this.isAvailable()) {
      logger.debug('Vector DB not available, skipping cleanup');
      return 0;
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await db
      .delete(researchEmbeddings)
      .where(sql`${researchEmbeddings.createdAt} < ${cutoffDate}`)
      .returning({ id: researchEmbeddings.id });

    return result.length;
  }
}

export const vectorStoreService = new VectorStoreService();
