import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export interface KnowledgeBaseConfig {
  name: string;
  embeddingModelUuid?: string;
  datasources?: DatasourceConfig[];
  description?: string;
  tags?: string[];
}

export interface DatasourceConfig {
  spaces_data_source?: {
    bucket_name: string;
    region: string;
  };
  web_crawler_data_source?: {
    base_url: string;
    crawling_option?: 'SCOPED' | 'FULL_DOMAIN' | 'UNKNOWN';
    embed_media?: boolean;
    exclude_tags?: string[];
  };
  file_url_data_source?: {
    url: string;
  };
  chunking_algorithm?:
  | 'CHUNKING_ALGORITHM_SECTION_BASED'
  | 'CHUNKING_ALGORITHM_SEMANTIC'
  | 'CHUNKING_ALGORITHM_HIERARCHICAL'
  | 'CHUNKING_ALGORITHM_FIXED_LENGTH';
  chunking_options?: {
    max_chunk_size?: number;
    semantic_threshold?: number;
    parent_chunk_size?: number;
    child_chunk_size?: number;
  };
}

export interface KnowledgeBase {
  id: string;
  name: string;
  status: 'creating' | 'provisioning' | 'ready' | 'failed';
  description?: string;
  projectId: string;
  region: string;
  embeddingModelUuid: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
}

export interface KnowledgeBaseResponse {
  knowledge_base: KnowledgeBase;
}

export interface ListKnowledgeBasesResponse {
  knowledge_bases: KnowledgeBase[];
}

export interface RetrieveResult {
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
  parent_content?: string;
}

export interface RetrieveResponse {
  results: Array<{
    page_content: string;
    score: number;
    metadata?: Record<string, unknown>;
    parent_content?: string;
  }>;
}

export class GradientKnowledgeBaseService {
  private baseUrl = 'https://api.digitalocean.com';
  private apiVersion = 'v2';
  // New dedicated retrieve endpoint (public preview)
  private retrieveBaseUrl = 'https://kbaas.do-ai.run';

  private async fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 30_000): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private requireAccessToken(): string {
    if (!config.DO_GENAI_API_KEY) {
      throw new Error('DO_GENAI_API_KEY is required for Gradient knowledge base operations');
    }
    return config.DO_GENAI_API_KEY;
  }

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.requireAccessToken()}`,
    };
  }

  // ── KB CRUD ────────────────────────────────────────────────

  async createKnowledgeBase(kbConfig: KnowledgeBaseConfig): Promise<KnowledgeBase> {
    const { name, embeddingModelUuid, datasources, description, tags } = kbConfig;

    if (!config.gradient.projectId) {
      throw new Error('GRADIENT_PROJECT_ID is required to create knowledge bases');
    }

    const payload: Record<string, unknown> = {
      name,
      embedding_model_uuid: embeddingModelUuid || config.gradient.kbEmbeddingModelUrn,
      project_id: config.gradient.projectId,
      region: config.gradient.region || 'tor1',
    };

    if (datasources && datasources.length > 0) {
      payload.datasources = datasources;
    }

    if (description) {
      payload.description = description;
    }

    if (tags && tags.length > 0) {
      payload.tags = tags;
    }

    logger.info({ kbName: name, projectId: config.gradient.projectId }, 'Creating Gradient Knowledge Base');

    const response = await this.fetchWithTimeout(`${this.baseUrl}/${this.apiVersion}/gen-ai/knowledge_bases`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error({ status: response.status, error }, 'Failed to create Gradient Knowledge Base');
      throw new Error(`Failed to create knowledge base: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as KnowledgeBaseResponse;
    logger.info({ kbId: data.knowledge_base.id }, 'Gradient Knowledge Base created successfully');
    return data.knowledge_base;
  }

  async getKnowledgeBase(kbId: string): Promise<KnowledgeBase> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}/${this.apiVersion}/gen-ai/knowledge_bases/${kbId}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get knowledge base: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as KnowledgeBaseResponse;
    return data.knowledge_base;
  }

  async listKnowledgeBases(): Promise<KnowledgeBase[]> {
    if (!config.gradient.projectId) {
      throw new Error('GRADIENT_PROJECT_ID is required to list knowledge bases');
    }

    const response = await this.fetchWithTimeout(
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

    const data = (await response.json()) as ListKnowledgeBasesResponse;
    return data.knowledge_bases || [];
  }

  async deleteKnowledgeBase(kbId: string): Promise<void> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}/${this.apiVersion}/gen-ai/knowledge_bases/${kbId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to delete knowledge base: ${response.status} - ${error}`);
    }

    logger.info({ kbId }, 'Gradient Knowledge Base deleted');
  }

  // ── Data Sources ───────────────────────────────────────────

  async addDataSource(kbId: string, dataSource: DatasourceConfig): Promise<void> {
    const payload = {
      knowledge_base_uuid: kbId,
      ...dataSource,
    };

    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/${this.apiVersion}/gen-ai/knowledge_bases/${kbId}/data_sources`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to add data source: ${response.status} - ${error}`);
    }

    logger.info({ kbId }, 'Data source added to knowledge base');
  }

  async indexKnowledgeBase(kbId: string): Promise<void> {
    const response = await this.fetchWithTimeout(
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

  // ── Convenience: Add data source + trigger re-index ────────

  async addDataSourceWithAutoReindex(kbId: string, dataSource: DatasourceConfig): Promise<void> {
    await this.addDataSource(kbId, dataSource);
    await this.indexKnowledgeBase(kbId);
  }

  /**
   * Store a research report as an inline file_url data source.
   * The report content is base64-encoded and ingested directly.
   */
  async addResearchReportAsSource(
    kbId: string,
    reportContent: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const reportJson = JSON.stringify({
      content: reportContent,
      metadata,
      generatedAt: new Date().toISOString(),
    });

    const dataSource: DatasourceConfig = {
      file_url_data_source: {
        url: `data:application/json;base64,${Buffer.from(reportJson).toString('base64')}`,
      },
      chunking_algorithm: 'CHUNKING_ALGORITHM_SEMANTIC',
      chunking_options: {
        max_chunk_size: 500,
        semantic_threshold: 0.6,
      },
    };

    await this.addDataSourceWithAutoReindex(kbId, dataSource);
  }

  // ── Retrieve (new kbaas.do-ai.run endpoint) ────────────────

  /**
   * Retrieve relevant chunks from a knowledge base using hybrid search.
   * Uses the new public preview endpoint at kbaas.do-ai.run.
   *
   * @param alpha  Balance between lexical (0) and semantic (1) retrieval.
   *               Default 0.5 provides a good mix.
   */
  async retrieveFromKnowledgeBase(
    kbId: string,
    query: string,
    options: { numResults?: number; alpha?: number; filters?: Record<string, unknown> } = {},
  ): Promise<RetrieveResult[]> {
    const { numResults = 5, alpha = 0.5, filters } = options;

    const payload: Record<string, unknown> = {
      query,
      num_results: numResults,
      alpha,
    };

    if (filters) {
      payload.filters = filters;
    }

    const response = await this.fetchWithTimeout(
      `${this.retrieveBaseUrl}/v1/${kbId}/retrieve`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to retrieve from knowledge base: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as RetrieveResponse;

    return (data.results || []).map(r => ({
      content: r.page_content,
      score: r.score,
      metadata: r.metadata,
      parent_content: r.parent_content,
    }));
  }

  /**
   * Legacy alias — delegates to the new retrieve endpoint.
   */
  async searchKnowledgeBase(
    kbId: string,
    query: string,
    limit = 5,
  ): Promise<Array<{ content: string; score: number; metadata?: Record<string, unknown> }>> {
    return this.retrieveFromKnowledgeBase(kbId, query, { numResults: limit });
  }

  // ── Helpers ────────────────────────────────────────────────

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
}

export interface SearchResult {
  content: string;
  score: number;
  source?: string;
  title?: string;
}

export const gradientKnowledgeBaseService = new GradientKnowledgeBaseService();
