import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export interface KnowledgeBaseConfig {
  name: string;
  embeddingModelUrn?: string;
  dataSources?: DataSource[];
  description?: string;
}

export interface DataSource {
  name: string;
  type: 'file_url' | 's3' | 'spaces' | 'web_crawler';
  url?: string;
  bucket?: string;
  prefix?: string;
  region?: string;
  baseUrl?: string;
  crawlingOption?: 'SCOPED' | 'FULL_DOMAIN';
  embedMedia?: boolean;
  excludeTags?: string[];
}

export interface SpacesDataSource {
  spaces_data_source: {
    bucket_name: string;
    region: string;
  };
}

export interface WebCrawlerDataSource {
  web_crawler_data_source: {
    base_url: string;
    crawling_option?: 'SCOPED' | 'FULL_DOMAIN';
    embed_media?: boolean;
    exclude_tags?: string[];
  };
}

export interface KnowledgeBase {
  id: string;
  name: string;
  status: 'creating' | 'provisioning' | 'ready' | 'failed';
  description?: string;
  projectId: string;
  region: string;
  embeddingModelUrn: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeBaseResponse {
  knowledge_base: KnowledgeBase;
}

export interface ListKnowledgeBasesResponse {
  knowledge_bases: KnowledgeBase[];
}

export class GradientKnowledgeBaseService {
  private baseUrl = 'https://api.digitalocean.com';
  private apiVersion = 'v2';

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.DO_GENAI_API_KEY}`,
    };
  }

  async createKnowledgeBase(kbConfig: KnowledgeBaseConfig): Promise<KnowledgeBase> {
    const { name, embeddingModelUrn, dataSources, description } = kbConfig;

    if (!config.gradient.projectId) {
      throw new Error('GRADIENT_PROJECT_ID is required to create knowledge bases');
    }

    const payload: Record<string, unknown> = {
      name,
      embedding_model_urn: embeddingModelUrn || config.gradient.kbEmbeddingModelUrn,
      project_id: config.gradient.projectId,
      region: config.gradient.region || 'tor1',
    };

    if (dataSources && dataSources.length > 0) {
      payload.data_sources = dataSources;
    }

    if (description) {
      payload.description = description;
    }

    logger.info({ kbName: name, projectId: config.gradient.projectId }, 'Creating Gradient Knowledge Base');

    const response = await fetch(`${this.baseUrl}/${this.apiVersion}/gen-ai/knowledge_bases`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error({ status: response.status, error }, 'Failed to create Gradient Knowledge Base');
      throw new Error(`Failed to create knowledge base: ${response.status} - ${error}`);
    }

    const data: KnowledgeBaseResponse = await response.json();
    logger.info({ kbId: data.knowledge_base.id }, 'Gradient Knowledge Base created successfully');
    return data.knowledge_base;
  }

  async getKnowledgeBase(kbId: string): Promise<KnowledgeBase> {
    const response = await fetch(`${this.baseUrl}/${this.apiVersion}/gen-ai/knowledge_bases/${kbId}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get knowledge base: ${response.status} - ${error}`);
    }

    const data: KnowledgeBaseResponse = await response.json();
    return data.knowledge_base;
  }

  async listKnowledgeBases(): Promise<KnowledgeBase[]> {
    if (!config.gradient.projectId) {
      throw new Error('GRADIENT_PROJECT_ID is required to list knowledge bases');
    }

    const response = await fetch(
      `${this.baseUrl}/${this.apiVersion}/gen-ai/knowledge_bases?project_id=${config.gradient.projectId}`,
      {
        method: 'GET',
        headers: this.getHeaders(),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to list knowledge bases: ${response.status} - ${error}`);
    }

    const data: ListKnowledgeBasesResponse = await response.json();
    return data.knowledge_bases || [];
  }

  async deleteKnowledgeBase(kbId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${this.apiVersion}/gen-ai/knowledge_bases/${kbId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to delete knowledge base: ${response.status} - ${error}`);
    }

    logger.info({ kbId }, 'Gradient Knowledge Base deleted');
  }

  async addDataSource(kbId: string, dataSource: DataSource): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/${this.apiVersion}/gen-ai/knowledge_bases/${kbId}/data_sources`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(dataSource),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to add data source: ${response.status} - ${error}`);
    }

    logger.info({ kbId, sourceName: dataSource.name }, 'Data source added to knowledge base');
  }

  async indexKnowledgeBase(kbId: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/${this.apiVersion}/gen-ai/knowledge_bases/${kbId}/index`,
      {
        method: 'POST',
        headers: this.getHeaders(),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to index knowledge base: ${response.status} - ${error}`);
    }

    logger.info({ kbId }, 'Knowledge base indexing initiated');
  }

  async waitForReady(kbId: string, maxAttempts = 30, intervalMs = 5000): Promise<KnowledgeBase> {
    let attempts = 0;

    while (attempts < maxAttempts) {
      const kb = await this.getKnowledgeBase(kbId);

      if (kb.status === 'ready') {
        return kb;
      }

      if (kb.status === 'failed') {
        throw new Error(`Knowledge base indexing failed for kb: ${kbId}`);
      }

      logger.info({ kbId, status: kb.status, attempt: attempts + 1 }, 'Waiting for knowledge base to be ready');
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      attempts++;
    }

    throw new Error(`Knowledge base did not become ready within ${maxAttempts * intervalMs}ms`);
  }

  async searchKnowledgeBase(kbId: string, query: string, limit = 5): Promise<SearchResult[]> {
    const response = await fetch(
      `${this.baseUrl}/${this.apiVersion}/gen-ai/knowledge_bases/${kbId}/search`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ query, limit }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to search knowledge base: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.results || [];
  }
}

export interface SearchResult {
  content: string;
  score: number;
  source?: string;
  title?: string;
}

export const gradientKnowledgeBaseService = new GradientKnowledgeBaseService();
