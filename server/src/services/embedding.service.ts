import { OpenAIEmbeddings } from '@langchain/openai';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export interface EmbeddingServiceConfig {
  modelName: string;
  dimensions: number;
}

export class EmbeddingService {
  private embedder: OpenAIEmbeddings | null = null;
  private config: EmbeddingServiceConfig;
  private embeddingProviderUnavailable = false;
  private unavailableReason?: string;

  constructor(customConfig?: Partial<EmbeddingServiceConfig>) {
    this.config = {
      modelName: customConfig?.modelName ?? 'text-embedding-3-small',
      dimensions: customConfig?.dimensions ?? 1536,
    };

    // DigitalOcean's serverless inference API does not expose an /v1/embeddings
    // endpoint. Embeddings only work with a real OpenAI API key.
    if (config.openaiApiKey) {
      this.embedder = new OpenAIEmbeddings({
        model: this.config.modelName,
        dimensions: this.config.dimensions,
        apiKey: config.openaiApiKey,
      });
    } else {
      this.embeddingProviderUnavailable = true;
      this.unavailableReason =
        'No OPENAI_API_KEY configured. DigitalOcean GenAI does not support embedding models. Semantic search features will be skipped.';
      logger.info(
        'Embedding provider unavailable (no OPENAI_API_KEY). Semantic operations will be skipped — this is non-critical.',
      );
    }
  }

  async embedQuery(text: string): Promise<number[]> {
    if (this.embeddingProviderUnavailable || !this.embedder) {
      return [];
    }

    try {
      return await this.embedder.embedQuery(text);
    } catch (error) {
      if (this.isEmbeddingUnavailableError(error)) {
        this.markEmbeddingUnavailable(error instanceof Error ? error.message : 'unknown embedding provider error');
        return [];
      }
      logger.error({ error }, 'Error embedding query');
      throw new Error(`Failed to embed query: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    if (this.embeddingProviderUnavailable || !this.embedder) {
      return [];
    }

    try {
      return await this.embedder.embedDocuments(documents);
    } catch (error) {
      if (this.isEmbeddingUnavailableError(error)) {
        this.markEmbeddingUnavailable(error instanceof Error ? error.message : 'unknown embedding provider error');
        return [];
      }
      logger.error({ error }, 'Error embedding documents');
      throw new Error(`Failed to embed documents: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async embedResearchChunks(chunks: Array<{
    content: string;
    source?: string;
    sourceType?: 'web_search' | 'report_section' | 'chat_message';
    metadata?: Record<string, unknown>;
  }>): Promise<Array<{
    content: string;
    embedding: number[];
    source?: string;
    sourceType?: 'web_search' | 'report_section' | 'chat_message';
    metadata?: Record<string, unknown>;
  }>> {
    if (chunks.length === 0) return [];

    const contents = chunks.map((c) => c.content);
    const embeddings = await this.embedDocuments(contents);
    if (embeddings.length !== contents.length) {
      logger.warn({ expected: contents.length, actual: embeddings.length }, 'Skipping report chunk embeddings due to unavailable embedding provider');
      return [];
    }

    return chunks.map((chunk, index) => ({
      ...chunk,
      embedding: embeddings[index]!,
    }));
  }

  getDimensions(): number {
    return this.config.dimensions;
  }

  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly RETRY_DELAY_MS = 5 * 60 * 1000; // 5 minutes

  private markEmbeddingUnavailable(reason: string): void {
    if (!this.embeddingProviderUnavailable) {
      logger.warn({ reason }, 'Embedding provider is unavailable; semantic embedding operations will be skipped');
    }
    this.embeddingProviderUnavailable = true;
    this.unavailableReason = reason;

    // Schedule retry to re-enable after transient failures
    if (!this.retryTimer && this.embedder) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.embeddingProviderUnavailable = false;
        this.unavailableReason = undefined;
        logger.info('Embedding provider re-enabled after retry delay');
      }, EmbeddingService.RETRY_DELAY_MS);
    }
  }

  private isEmbeddingUnavailableError(error: unknown): boolean {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return (
      message.includes('route not allowed') ||
      message.includes('could not be routed') ||
      message.includes('status: 401') ||
      message.includes('status: 404') ||
      message.includes('authentication')
    );
  }
}

export const embeddingService = new EmbeddingService();

