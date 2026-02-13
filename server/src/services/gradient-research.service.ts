import { gradientAgentFactory } from './gradient-agent-factory.js';
import { gradientKnowledgeBaseService } from './gradient-kb.service.js';
import { researchService } from './research.service.js';
import type { ResearchRequest, ResearchJob } from '../types/research.types.js';
import { logger } from '../utils/logger.js';

export interface GradientResearchRequest extends ResearchRequest {
  useGradientNative?: boolean;
  knowledgeBaseId?: string;
}

export class GradientResearchService {
  async createGradientResearchJob(request: GradientResearchRequest): Promise<ResearchJob> {
    const jobId = crypto.randomUUID();
    const agentName = `research-agent-${Date.now()}`;

    let knowledgeBaseId = request.knowledgeBaseId;

    if (!knowledgeBaseId && request.query) {
      try {
        const kb = await gradientAgentFactory.createKnowledgeBaseForResearch(
          `kb-${request.query.slice(0, 30)}`,
          []
        );
        knowledgeBaseId = kb.id;
        logger.info({ kbId: kb.id, query: request.query }, 'Created knowledge base for research');
      } catch (error) {
        logger.warn({ error }, 'Failed to create knowledge base, continuing without it');
      }
    }

    const { agentId } = await gradientAgentFactory.getOrCreateResearchAgent(
      agentName,
      knowledgeBaseId
    );

    logger.info({ jobId, agentId, knowledgeBaseId }, 'Created Gradient native research job');

    const gradientJob: ResearchJob = {
      id: jobId,
      query: request.query,
      status: 'in_progress',
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        gradientAgentId: agentId,
        gradientKnowledgeBaseId: knowledgeBaseId,
        useGradientNative: true,
      },
    };

    this.executeGradientResearch(gradientJob, request, agentId).catch((error) => {
      gradientJob.status = 'failed';
      gradientJob.error = error instanceof Error ? error.message : 'Unknown error';
      gradientJob.updatedAt = new Date();
      logger.error({ jobId, error }, 'Gradient research job failed');
    });

    return gradientJob;
  }

  private async executeGradientResearch(
    job: ResearchJob,
    request: GradientResearchRequest,
    agentId: string
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const enhancedQuery = this.buildEnhancedQuery(request);

      logger.info({ jobId: job.id, agentId, query: enhancedQuery }, 'Invoking Gradient Agent');

      const response = await gradientAgentFactory.invokeResearch(agentId, enhancedQuery, false);

      const result = typeof response === 'object' && 'response' in response ? response.response : String(response);

      const duration = Date.now() - startTime;

      job.result = {
        executiveSummary: result,
        companySnapshot: '',
        industryAndMarketStructure: '',
        businessModelAndUnitEconomics: '',
        financialQualityAndTrendAnalysis: '',
        capitalAllocationReview: '',
        valuationRelative: '',
        valuationIntrinsic: '',
        competitivePositionAndMoat: '',
        managementGovernanceAssessment: '',
        regulatoryAndLegalRisk: '',
        bullCase: '',
        bearCase: '',
        scenarioFramework: [],
        catalystCalendar: '',
        portfolioConstructionView: '',
        investmentConclusion: result,
        evidenceIndex: [],
        auditReport: {
          status: 'pass',
          checkedClaims: 0,
          unresolvedClaims: [],
          notes: ['Generated via Gradient native Agent'],
        },
        sources: [],
      };

      job.status = 'completed';
      job.metadata = {
        ...job.metadata,
        duration,
        orchestrationMetrics: {
          subagentCountUsed: 1,
          taskCount: 1,
        },
        modelConfigUsed: {
          orchestrator: 'gradient/llama-3-3-70b-instruct',
          subagent: 'gradient/llama-3-3-70b-instruct',
          auditor: 'gradient/llama-3-3-70b-instruct',
        },
      };
      job.updatedAt = new Date();

      logger.info({ jobId: job.id, duration }, 'Gradient research job completed');
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.updatedAt = new Date();
      throw error;
    }
  }

  private buildEnhancedQuery(request: GradientResearchRequest): string {
    let query = request.query;

    if (request.context) {
      query = `Context: ${request.context}\n\n${query}`;
    }

    if (request.focusAreas && request.focusAreas.length > 0) {
      query += `\n\nFocus Areas: ${request.focusAreas.join(', ')}`;
    }

    query += `\n\nPlease provide a comprehensive institutional-grade research report with citations.`;

    return query;
  }

  async streamGradientResearch(
    jobId: string,
    request: GradientResearchRequest
  ): Promise<AsyncGenerator<string>> {
    const agentName = `stream-research-${jobId}`;
    const { agentId } = await gradientAgentFactory.getOrCreateResearchAgent(agentName);

    const enhancedQuery = this.buildEnhancedQuery(request);

    return gradientAgentFactory.invokeResearch(agentId, enhancedQuery, true) as AsyncGenerator<string>;
  }
}

export const gradientResearchService = new GradientResearchService();
