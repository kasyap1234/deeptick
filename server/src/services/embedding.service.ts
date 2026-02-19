import { OpenAIEmbeddings } from '@langchain/openai';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export interface EmbeddingServiceConfig {
  modelName: string;
  dimensions: number;
}

const GRADIENT_EMBEDDING_ENDPOINT = 'https://api.digitalocean.com/v2/ai';

export class EmbeddingService {
  private embedder: OpenAIEmbeddings;
  private config: EmbeddingServiceConfig;
  private useGradientNative: boolean;

  constructor(customConfig?: Partial<EmbeddingServiceConfig>) {
    this.useGradientNative = Boolean(config.gradient.projectId && config.gradient.kbEmbeddingModelUrn);

    this.config = {
      modelName: customConfig?.modelName ?? 'text-embedding-3-small',
      dimensions: customConfig?.dimensions ?? 1536,
    };

    if (this.useGradientNative) {
      this.embedder = new OpenAIEmbeddings({
        model: 'text-embedding-ada-002',
        dimensions: 1536,
        apiKey: config.DO_GENAI_API_KEY,
        configuration: {
          baseURL: GRADIENT_EMBEDDING_ENDPOINT,
        },
      });
    } else {
      this.embedder = new OpenAIEmbeddings({
        model: this.config.modelName,
        dimensions: this.config.dimensions,
        apiKey: config.DO_GENAI_API_KEY,
        configuration: {
          baseURL: config.DO_GENAI_ENDPOINT,
        },
      });
    }
  }

  async embedQuery(text: string): Promise<number[]> {
    try {
      if (this.useGradientNative) {
        return await this.gradientEmbed([text]).then(res => res[0]);
      }
      const embedding = await this.embedder.embedQuery(text);
      return embedding;
    } catch (error) {
      logger.error({ error, useGradientNative: this.useGradientNative }, 'Error embedding query');
      throw new Error(`Failed to embed query: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    try {
      if (this.useGradientNative) {
        return await this.gradientEmbed(documents);
      }
      const embeddings = await this.embedder.embedDocuments(documents);
      return embeddings;
    } catch (error) {
      logger.error({ error, useGradientNative: this.useGradientNative }, 'Error embedding documents');
      throw new Error(`Failed to embed documents: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async gradientEmbed(texts: string[]): Promise<number[][]> {
    const projectId = config.gradient.projectId;
    if (!projectId) {
      throw new Error('Gradient project ID not configured');
    }

    const response = await fetch(`${GRADIENT_EMBEDDING_ENDPOINT}/projects/${projectId}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.DO_GENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.gradient.kbEmbeddingModelUrn || 'text-embedding-ada-002',
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gradient embedding API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      data?: Array<{ embedding?: number[] }>;
    };

    const embeddings = data.data?.map(item => item.embedding || []).filter(e => e.length > 0);
    if (!embeddings || embeddings.length === 0) {
      throw new Error('No embeddings returned from Gradient API');
    }

    return embeddings;
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
