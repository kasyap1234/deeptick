import { gradientAgentService } from './gradient-agent.service.js';
import { gradientKnowledgeBaseService, type KnowledgeBase } from './gradient-kb.service.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const RESEARCH_AGENT_INSTRUCTION = `You are DeepTick, an institutional-grade AI research assistant for retail investors. You provide comprehensive, evidence-based stock analysis that rivals what a 1000-member institutional research team would produce.

CORE CAPABILITIES:
- Deep fundamental analysis
- Bull and bear case construction
- Risk assessment and scenario planning
- Competitive positioning analysis
- Valuation modeling

RESPONSE GUIDELINES:
1. Be concise but thorough - every sentence should add value
2. Cite specific data points with context
3. Balance bullish and bearish perspectives
4. Use bullet points for readability
5. End with clear, actionable takeaways
6. If you're uncertain, acknowledge limitations`;

export interface GradientResearchAgentResult {
  agentId: string;
  knowledgeBaseId?: string;
  service: typeof gradientAgentService;
}

export class GradientAgentFactory {
  private agentCache: Map<string, GradientResearchAgentResult> = new Map();

  async getOrCreateResearchAgent(
    agentName: string,
    knowledgeBaseId?: string
  ): Promise<GradientResearchAgentResult> {
    const cacheKey = `${agentName}-${knowledgeBaseId || 'no-kb'}`;

    if (this.agentCache.has(cacheKey)) {
      return this.agentCache.get(cacheKey)!;
    }

    const existingAgents = await gradientAgentService.listAgents();
    let agent = existingAgents.find((a) => a.name === agentName);

    if (!agent) {
      logger.info({ agentName }, 'Creating new Gradient Research Agent');
      agent = await gradientAgentService.createAgent({
        name: agentName,
        instruction: RESEARCH_AGENT_INSTRUCTION,
        description: 'Institutional-grade equity research agent for DeepTick',
        knowledgeBaseUuids: knowledgeBaseId ? [knowledgeBaseId] : undefined,
      });
    } else if (knowledgeBaseId && !agent.knowledgeBaseUuids.includes(knowledgeBaseId)) {
      await gradientAgentService.attachKnowledgeBases(agent.id, [...agent.knowledgeBaseUuids, knowledgeBaseId]);
    }

    const result: GradientResearchAgentResult = {
      agentId: agent.id,
      knowledgeBaseId,
      service: gradientAgentService,
    };

    this.agentCache.set(cacheKey, result);
    return result;
  }

  async createKnowledgeBaseForResearch(
    name: string,
    dataSources?: Array<{ url: string; name: string }>
  ): Promise<KnowledgeBase> {
    const kb = await gradientKnowledgeBaseService.createKnowledgeBase({
      name,
      description: `Research knowledge base for ${name}`,
    });

    if (dataSources && dataSources.length > 0) {
      for (const source of dataSources) {
        await gradientKnowledgeBaseService.addDataSource(kb.id, {
          name: source.name,
          type: 'file_url',
          url: source.url,
        });
      }

      await gradientKnowledgeBaseService.indexKnowledgeBase(kb.id);
      return await gradientKnowledgeBaseService.waitForReady(kb.id);
    }

    return kb;
  }

  async invokeResearch(
    agentId: string,
    query: string,
    useStreaming = false
  ): Promise<AsyncGenerator<string> | { response: string }> {
    if (useStreaming) {
      return gradientAgentService.streamAgent(agentId, query);
    }

    return await gradientAgentService.invokeAgent(agentId, query);
  }

  clearCache(): void {
    this.agentCache.clear();
  }
}

export const gradientAgentFactory = new GradientAgentFactory();
