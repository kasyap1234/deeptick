import { OpenAIEmbeddings } from '@langchain/openai';
import { config } from '../config/index.js';

export interface EmbeddingServiceConfig {
  modelName: string;
  dimensions: number;
}

export class EmbeddingService {
  private embedder: OpenAIEmbeddings;
  private config: EmbeddingServiceConfig;

  constructor(customConfig?: Partial<EmbeddingServiceConfig>) {
    this.config = {
      modelName: customConfig?.modelName ?? 'text-embedding-3-small',
      dimensions: customConfig?.dimensions ?? 1536,
    };

    this.embedder = new OpenAIEmbeddings({
      model: this.config.modelName,
      dimensions: this.config.dimensions,
      apiKey: config.DO_GENAI_API_KEY,
    });
  }

  async embedQuery(text: string): Promise<number[]> {
    try {
      const embedding = await this.embedder.embedQuery(text);
      return embedding;
    } catch (error) {
      console.error('Error embedding query:', error);
      throw new Error(`Failed to embed query: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    try {
      const embeddings = await this.embedder.embedDocuments(documents);
      return embeddings;
    } catch (error) {
      console.error('Error embedding documents:', error);
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
