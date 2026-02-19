import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { gradientAgentService, type RetrievalInfo } from './gradient-agent.service.js';
import { gradientKnowledgeBaseService } from './gradient-kb.service.js';

function usePreconfiguredAgent(): boolean {
  return Boolean(config.gradient.agentEndpoint && config.gradient.agentAccessKey);
}

export interface CacheResult {
  hit: boolean;
  content?: string;
  retrievedData?: RetrievalInfo['retrieved_data'];
  source?: 'gradient-kb';
}

export interface CachedResearchItem {
  query: string;
  result: string;
  timestamp: string;
  sources?: string[];
}

const CACHE_KB_NAME = 'deeptick-research-cache';
const CACHE_AGENT_NAME = 'deeptick-cache-checker';

const CACHE_AGENT_INSTRUCTION = `You are a research cache checker. Your job is to:
1. Search the attached knowledge base for any existing research that matches or is similar to the user's query
2. If you find relevant research, extract and summarize the key findings
3. Be concise - just provide the cached research results

If no relevant research exists in the knowledge base, simply state that no cached research was found.`;

export class GradientCacheService {
  private cacheAgentId: string | null = null;
  private cacheKbId: string | null = null;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized || !config.isUsingGradient) {
      return;
    }

    if (usePreconfiguredAgent()) {
      logger.info('Using pre-configured Gradient agent from environment');
      this.cacheAgentId = 'preconfigured';
      this.initialized = true;
      return;
    }

    if (!config.gradient.projectId) {
      throw new Error('GRADIENT_PROJECT_ID required when not using pre-configured agent');
    }

    try {
      await this.setupCacheKB();
      await this.setupCacheAgent();
      this.initialized = true;
      logger.info('Gradient Cache Service initialized successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize Gradient Cache Service');
      throw error;
    }
  }

  private async setupCacheKB(): Promise<void> {
    if (!config.gradient.projectId) {
      logger.info('No GRADIENT_PROJECT_ID - skipping KB creation');
      return;
    }

    const existingKBs = await gradientKnowledgeBaseService.listKnowledgeBases();
    let cacheKB = existingKBs.find(kb => kb.name === CACHE_KB_NAME);

    if (!cacheKB) {
      logger.info('Creating new cache knowledge base');
      cacheKB = await gradientKnowledgeBaseService.createKnowledgeBase({
        name: CACHE_KB_NAME,
        description: 'DeepTick Research Cache - stores completed research for quick retrieval',
      });
    }

    this.cacheKbId = cacheKB.id;
    logger.info({ kbId: this.cacheKbId }, 'Cache KB ready');
  }

  private async setupCacheAgent(): Promise<void> {
    if (!config.gradient.projectId) {
      return;
    }

    const existingAgents = await gradientAgentService.listAgents();
    let cacheAgent = existingAgents.find(agent => agent.name === CACHE_AGENT_NAME);

    if (!cacheAgent) {
      logger.info('Creating new cache checker agent');
      cacheAgent = await gradientAgentService.createAgentWithEndpoint({
        name: CACHE_AGENT_NAME,
        instruction: CACHE_AGENT_INSTRUCTION,
        description: 'Agent for checking research cache',
        knowledgeBaseUuids: this.cacheKbId ? [this.cacheKbId] : undefined,
      });
    } else if (this.cacheKbId && !cacheAgent.knowledgeBaseUuids.includes(this.cacheKbId)) {
      await gradientAgentService.attachKnowledgeBases(cacheAgent.id, [...cacheAgent.knowledgeBaseUuids, this.cacheKbId]);
    }

    this.cacheAgentId = cacheAgent.id;
    logger.info({ agentId: this.cacheAgentId }, 'Cache Agent ready');
  }

  async checkCache(query: string): Promise<CacheResult> {
    if (!config.isUsingGradient || !this.cacheAgentId) {
      return { hit: false };
    }

    try {
      let result;

      if (usePreconfiguredAgent() && config.gradient.agentEndpoint && config.gradient.agentAccessKey) {
        result = await this.invokePreconfiguredAgent(query);
      } else {
        result = await gradientAgentService.invokeAgentWithRetrieval(
          this.cacheAgentId,
          query,
          { includeRetrievalInfo: true }
        );
      }

      if (result.retrieval?.retrieved_data && result.retrieval.retrieved_data.length > 0) {
        logger.info({ 
          query: query.substring(0, 50), 
          retrievedCount: result.retrieval.retrieved_data.length 
        }, 'Cache hit in Gradient KB');

        return {
          hit: true,
          content: result.response,
          retrievedData: result.retrieval.retrieved_data,
          source: 'gradient-kb',
        };
      }

      return { hit: false };
    } catch (error) {
      logger.error({ error, query: query.substring(0, 50) }, 'Error checking Gradient cache');
      return { hit: false };
    }
  }

  private async invokePreconfiguredAgent(query: string): Promise<{
    response: string;
    retrieval?: RetrievalInfo;
  }> {
    const endpoint = config.gradient.agentEndpoint!;
    const accessKey = config.gradient.agentAccessKey!;

    const response = await fetch(`${endpoint}/api/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessKey}`,
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: query }],
        stream: false,
        include_retrieval_info: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to invoke pre-configured agent: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    return {
      response: ((data.choices as any)?.[0]?.message?.content as string | undefined) || '',
      retrieval: data.retrieval as RetrievalInfo | undefined,
    };
  }

  async *checkCacheStream(query: string): AsyncGenerator<CacheResult> {
    if (!config.isUsingGradient || !this.cacheAgentId) {
      yield { hit: false };
      return;
    }

    let buffer = '';
    let retrievalData: RetrievalInfo['retrieved_data'] = [];

    try {
      for await (const chunk of gradientAgentService.streamAgentWithRetrieval(
        this.cacheAgentId,
        query,
        { includeRetrievalInfo: true }
      )) {
        buffer += chunk.content;
        
        if (chunk.retrieval?.retrieved_data) {
          retrievalData = chunk.retrieval.retrieved_data;
        }

        yield {
          hit: retrievalData.length > 0,
          content: buffer,
          retrievedData: retrievalData,
          source: 'gradient-kb',
        };
      }
    } catch (error) {
      logger.error({ error }, 'Error streaming Gradient cache check');
      yield { hit: false };
    }
  }

  async addToCache(query: string, result: string, sources?: string[]): Promise<void> {
    if (!config.isUsingGradient || !this.cacheKbId) {
      logger.debug('Gradient not enabled or cache not initialized, skipping cache update');
      return;
    }

    logger.info({ query: query.substring(0, 50) }, 'Adding research to Gradient cache');
    
    const dataSourceName = `research-${Date.now()}-${query.substring(0, 30).replace(/[^a-zA-Z0-9]/g, '-')}`;
    
    try {
      await gradientKnowledgeBaseService.addDataSource(this.cacheKbId, {
        name: dataSourceName,
        type: 'file_url',
        url: `data:text/plain;base64,${Buffer.from(JSON.stringify({
          query,
          result,
          sources,
          timestamp: new Date().toISOString(),
        })).toString('base64')}`,
      });

      await gradientKnowledgeBaseService.indexKnowledgeBase(this.cacheKbId);
      
      logger.info({ query: query.substring(0, 50) }, 'Research added to Gradient cache');
    } catch (error) {
      logger.error({ error }, 'Failed to add research to cache');
    }
  }

  isReady(): boolean {
    return this.initialized && this.cacheAgentId !== null;
  }

  getCacheAgentId(): string | null {
    return this.cacheAgentId;
  }

  getCacheKBId(): string | null {
    return this.cacheKbId;
  }

  async clearCache(): Promise<void> {
    if (this.cacheKbId) {
      await gradientKnowledgeBaseService.deleteKnowledgeBase(this.cacheKbId);
      this.cacheKbId = null;
      this.cacheAgentId = null;
      this.initialized = false;
      logger.info('Gradient cache cleared');
    }
  }
}

export const gradientCacheService = new GradientCacheService();
