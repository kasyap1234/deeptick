import { OpenAIEmbeddings } from '@langchain/openai';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export interface EmbeddingServiceConfig {
  modelName: string;
  dimensions: number;
}

export class EmbeddingService {
  private embedder: OpenAIEmbeddings;
  private config: EmbeddingServiceConfig;

  constructor(customConfig?: Partial<EmbeddingServiceConfig>) {
    const useGradient = config.DO_GENAI_ENDPOINT.includes('gradient');

    this.config = {
      modelName: customConfig?.modelName ?? 'text-embedding-3-small',
      dimensions: customConfig?.dimensions ?? 1536,
    };

    if (useGradient) {
      this.config.modelName = 'gradient/text-embedding-ada-002';
    }

    this.embedder = new OpenAIEmbeddings({
      model: this.config.modelName,
      dimensions: this.config.dimensions,
      apiKey: config.DO_GENAI_API_KEY,
      configuration: {
        baseURL: config.DO_GENAI_ENDPOINT,
      },
    });
  }

  async embedQuery(text: string): Promise<number[]> {
    try {
      const embedding = await this.embedder.embedQuery(text);
      return embedding;
    } catch (error) {
      logger.error({ error }, 'Error embedding query');
      throw new Error(`Failed to embed query: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    try {
      const embeddings = await this.embedder.embedDocuments(documents);
      return embeddings;
    } catch (error) {
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

    return chunks.map((chunk, index) => ({
      ...chunk,
      embedding: embeddings[index]!,
    }));
  }

  getDimensions(): number {
    return this.config.dimensions;
  }
}

export const embeddingService = new EmbeddingService();
