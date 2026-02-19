import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import {
  type InstitutionalResearchReport,
  type ResearchJob,
  type ResearchRequest,
  type ResearchSource,
  type WebSocketMessage,
  type WebSocketLike,
  isInstitutionalResearchReport,
} from '../types/research.types.js';
import { getDb } from '../db/connection.js';
import { researchJobs, sources as sourceTable } from '../db/schema.js';
import { gradientCacheService } from './gradient-cache.service.js';
import { semanticPromptCache } from './prompt-cache.service.js';
import { reportIndexerService } from './report-indexer.service.js';
import { config } from '../config/index.js';
import { createResearchAgent } from './deep-research/agent-factory.js';
import { guardrailsService } from './guardrails.service.js';
import { logger } from '../utils/logger.js';

type FileDataLike = { content: string[] } | string | null | undefined;

type AgentInvokeResult = {
  messages: Array<{ content: unknown }>;
  files?: Record<string, FileDataLike>;
  todos?: Array<{ content: string }>;
};

const MINIMUM_SOURCE_TARGETS = {
  uniqueSources: 80,
  domains: 12,
  recentSources: 25,
};

function getFileContent(file: FileDataLike): string | undefined {
  if (!file) return undefined;
  if (typeof file === 'string') return file;
  if (Array.isArray(file.content)) return file.content.join('\n');
  return undefined;
}

function parseMaybeJson<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function extractDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function isRecentDate(value?: string): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;

  const ninetyDaysAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
  return parsed >= ninetyDaysAgo;
}

function formatGuardrailError(triggered: Array<{ message: string }>): string {
  if (triggered.length === 0) {
    return 'Request blocked by guardrails policy.';
  }

  return `Request blocked by guardrails policy: ${triggered.map((rule) => rule.message).join('; ')}`;
}

export class ResearchService {
  private jobs: Map<string, ResearchJob> = new Map();
  private wsConnections: Map<string, Set<WebSocketLike>> = new Map();

  private async updateJobStatus(
    jobId: string,
    status: 'pending' | 'in_progress' | 'completed' | 'failed',
    result?: unknown,
    error?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const db = getDb();
    await db
      .update(researchJobs)
      .set({
        status,
        result: result ?? null,
        error: error ?? null,
        metadata: metadata ?? {},
        updatedAt: new Date(),
      })
      .where(eq(researchJobs.id, jobId));
  }

  async createResearchJob(request: ResearchRequest): Promise<ResearchJob> {
    const id = crypto.randomUUID();
    const userId = request.userId ?? 'websocket-anonymous';
    const job: ResearchJob = {
      id,
      userId,
      query: request.query,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.jobs.set(id, job);

    const db = getDb();
    await db.insert(researchJobs).values({
      id: job.id,
      userId: job.userId,
      query: job.query,
      status: job.status,
      result: null,
      metadata: {},
      error: null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });

    this.executeResearch(id, request)
      .then(() => logger.info({ jobId: id }, 'Research completed successfully'))
      .catch((error) => {
        logger.error({ jobId: id, error }, 'Research failed');
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : 'Unknown error';
        job.updatedAt = new Date();

        this.updateJobStatus(id, 'failed', undefined, job.error).catch(dbErr => {
          logger.error({ jobId: id, error: dbErr }, 'Failed to update job status in DB');
        });

        this.broadcastToJob(id, {
          type: 'error',
          jobId: id,
          payload: { error: job.error },
          timestamp: new Date(),
        });
      });

    const timeoutMs = 300000; // 5 minutes for complex research
    setTimeout(() => {
      if (job.status === 'in_progress' || job.status === 'pending') {
        job.status = 'failed';
        job.error = 'Research timed out after 2 minutes. Please check your LLM API key and ensure the service is accessible.';
        job.updatedAt = new Date();

        this.updateJobStatus(id, 'failed', undefined, job.error).catch(dbErr => {
          logger.error({ jobId: id, error: dbErr }, 'Failed to update job status in DB');
        });

        this.broadcastToJob(id, {
          type: 'error',
          jobId: id,
          payload: { error: job.error },
          timestamp: new Date(),
        });
      }
    }, timeoutMs);

    return job;
  }

  private broadcastStage(jobId: string, stage: string, details?: Record<string, unknown>): void {
    this.broadcastToJob(jobId, {
      type: 'progress',
      jobId,
      payload: {
        stage,
        ...details,
      },
      timestamp: new Date(),
    });
  }

  private async executeResearch(jobId: string, request: ResearchRequest): Promise<void> {
    logger.info({ jobId, query: request.query }, 'Starting research execution');
    
    const job = this.jobs.get(jobId);
    if (!job) {
      logger.error({ jobId }, 'Job not found in memory');
      return;
    }

    const guardrailsInput = [
      `Query: ${request.query}`,
      request.context ? `Context: ${request.context}` : undefined,
      request.focusAreas?.length ? `Focus Areas: ${request.focusAreas.join(', ')}` : undefined,
    ].filter(Boolean).join('\n');

    const inputGuardrailResult = await guardrailsService.checkContent(guardrailsInput);
    if (!inputGuardrailResult.passed) {
      const guardrailError = formatGuardrailError(inputGuardrailResult.triggered);
      job.status = 'failed';
      job.error = guardrailError;
      job.updatedAt = new Date();

      await this.updateJobStatus(jobId, 'failed', undefined, guardrailError);

      this.broadcastToJob(jobId, {
        type: 'error',
        jobId,
        payload: {
          error: guardrailError,
          guardrails: inputGuardrailResult.triggered,
        },
        timestamp: new Date(),
      });

      return;
    }

    const cachedResult = await semanticPromptCache.searchCache({
      userId: job.userId,
      query: request.query,
      context: request.context ? { query: request.context } : undefined,
      focusAreas: request.focusAreas,
      similarityThreshold: 0.85,
    });

    if (cachedResult) {
      logger.info({ jobId, similarity: cachedResult.similarity }, 'Returning cached result');
      
      job.result = cachedResult.responseText;
      job.status = 'completed';
      job.metadata = {
        cached: true,
        cacheId: cachedResult.id,
        similarity: cachedResult.similarity,
      };
      job.updatedAt = new Date();

      await this.updateJobStatus(jobId, 'completed', cachedResult.responseText, undefined, job.metadata as Record<string, unknown>);

      this.broadcastToJob(jobId, {
        type: 'result',
        jobId,
        payload: { 
          result: cachedResult.responseText, 
          metadata: job.metadata,
          cached: true,
        },
        timestamp: new Date(),
      });

      return;
    }

    job.status = 'in_progress';
    job.updatedAt = new Date();
    logger.info({ jobId }, 'Job status set to in_progress');

    await this.updateJobStatus(jobId, 'in_progress');

    this.broadcastToJob(jobId, {
      type: 'status',
      jobId,
      payload: { status: 'in_progress' },
      timestamp: new Date(),
    });

    this.broadcastStage(jobId, 'planning');

    const startTime = Date.now();

    try {
      const { agent, artifactRoot, modelConfig } = await createResearchAgent(jobId, guardrailsInput);

      this.broadcastStage(jobId, 'delegating', {
        expectedSubagents: 18,
      });

      const contextPrefix = request.context ? `Context: ${request.context}\n\n` : '';
      const focusAreas = request.focusAreas?.length
        ? `Focus Areas: ${request.focusAreas.join(', ')}\n\n`
        : '';
      const targetSourceMessage = `Source Coverage Requirements: minimum ${MINIMUM_SOURCE_TARGETS.uniqueSources} unique sources, ${MINIMUM_SOURCE_TARGETS.domains} domains, and ${MINIMUM_SOURCE_TARGETS.recentSources} recent sources (last 90 days).`;

      const result = await agent.invoke({
        messages: [{
          role: 'user',
          content: `${contextPrefix}${focusAreas}Research Query: ${request.query}\n\n${targetSourceMessage}\n\nProduce a comprehensive institutional-grade report with claim-level citations.`,
        }],
      }) as AgentInvokeResult;

      this.broadcastStage(jobId, 'reconciling');

      const duration = Date.now() - startTime;
      const files = result.files ?? {};
      const filesAsStrings = this.flattenFiles(files);
      const sources = this.extractSources(filesAsStrings);

      const report = await this.buildReport({
        files: filesAsStrings,
        artifactRoot,
        fallbackSummary: result.messages[result.messages.length - 1]?.content,
        sources,
      });

      const outputGuardrailResult = await guardrailsService.checkContent('', JSON.stringify(report));
      if (!outputGuardrailResult.passed) {
        const guardrailError = formatGuardrailError(outputGuardrailResult.triggered);
        job.status = 'failed';
        job.error = guardrailError;
        job.updatedAt = new Date();

        await this.updateJobStatus(jobId, 'failed', undefined, guardrailError, {
          guardrails: {
            stage: 'output',
            triggered: outputGuardrailResult.triggered,
          },
        });

        this.broadcastToJob(jobId, {
          type: 'error',
          jobId,
          payload: {
            error: guardrailError,
            guardrails: outputGuardrailResult.triggered,
          },
          timestamp: new Date(),
        });

        return;
      }

      this.broadcastStage(jobId, 'auditing');

      const sourceMetrics = this.calculateSourceMetrics(sources);
      const isSourceCoverageMet =
        sourceMetrics.uniqueSources >= MINIMUM_SOURCE_TARGETS.uniqueSources &&
        sourceMetrics.domainCount >= MINIMUM_SOURCE_TARGETS.domains &&
        sourceMetrics.recentSourceCount >= MINIMUM_SOURCE_TARGETS.recentSources;

      if (!isSourceCoverageMet) {
        report.auditReport.status = 'pass_with_caveats';
        report.auditReport.notes.push(
          `Source coverage below target. uniqueSources=${sourceMetrics.uniqueSources}/${MINIMUM_SOURCE_TARGETS.uniqueSources}, domains=${sourceMetrics.domainCount}/${MINIMUM_SOURCE_TARGETS.domains}, recentSources=${sourceMetrics.recentSourceCount}/${MINIMUM_SOURCE_TARGETS.recentSources}`,
        );
      }

      job.result = report;
      job.status = 'completed';
      job.metadata = {
        todoList: result.todos?.map((todo) => todo.content),
        files: filesAsStrings,
        duration,
        sourceMetrics,
        orchestrationMetrics: {
          subagentCountUsed: 18,
          taskCount: result.todos?.length ?? 0,
        },
        auditStatus: report.auditReport.status,
        artifactRoot,
        modelConfigUsed: modelConfig,
      };
      job.updatedAt = new Date();

      await this.updateJobStatus(jobId, 'completed', report, undefined, job.metadata as Record<string, unknown>);

      this.broadcastStage(jobId, 'finalizing', {
        uniqueSources: sourceMetrics.uniqueSources,
        domainCount: sourceMetrics.domainCount,
      });

      this.broadcastToJob(jobId, {
        type: 'result',
        jobId,
        payload: { result: report, metadata: job.metadata },
        timestamp: new Date(),
      });

      await this.storeInVectorDB(job);

      try {
        await reportIndexerService.indexReport({
          jobId: job.id,
          userId: job.userId,
        });
      } catch (indexError) {
        logger.warn({ error: indexError }, 'Failed to index report');
      }

      try {
        await semanticPromptCache.addToCache({
          userId: job.userId,
          query: job.query,
          response: JSON.stringify(report),
          responseMetadata: {
            sourceCount: sourceMetrics.uniqueSources,
            domainCount: sourceMetrics.domainCount,
            duration,
          },
          context: request.context ? { query: request.context } : undefined,
          focusAreas: request.focusAreas,
        });
      } catch (cacheError) {
        logger.warn({ error: cacheError }, 'Failed to add result to semantic cache');
      }

      if (config.isUsingGradient && report.investmentConclusion) {
        try {
          const sources = report.sources?.map(s => s.url).filter(Boolean) || [];
          await gradientCacheService.addToCache(
            job.query,
            report.investmentConclusion,
            sources
          );
        } catch (cacheError) {
          logger.warn({ error: cacheError }, 'Failed to add result to Gradient cache');
        }
      }
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.updatedAt = new Date();

      await this.updateJobStatus(jobId, 'failed', undefined, job.error);

      this.broadcastToJob(jobId, {
        type: 'error',
        jobId,
        payload: { error: job.error },
        timestamp: new Date(),
      });

      throw error;
    }
  }

  private flattenFiles(files: Record<string, FileDataLike>): Record<string, string> {
    const flattened: Record<string, string> = {};
    for (const [key, value] of Object.entries(files)) {
      const content = getFileContent(value);
      if (content) {
        flattened[key] = content;
      }
    }
    return flattened;
  }

  private extractSources(files: Record<string, string>): ResearchSource[] {
    const sources: ResearchSource[] = [];
    const seenUrls = new Set<string>();

    for (const content of Object.values(files)) {
      const extractedFromExa = this.extractFromExaJson(content);
      for (const source of extractedFromExa) {
        if (!seenUrls.has(source.url)) {
          seenUrls.add(source.url);
          sources.push(source);
        }
      }

      const urlMatches = content.match(/https?:\/\/[^\s)\]>"]+/g) ?? [];
      for (const url of urlMatches) {
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);
        sources.push({
          url,
          title: extractDomain(url) ?? 'Research Source',
          domain: extractDomain(url),
        });
      }
    }

    return sources;
  }

  private extractFromExaJson(content: string): ResearchSource[] {
    const parsed = parseMaybeJson<{ results?: Array<Record<string, unknown>> }>(content);
    if (!parsed || !Array.isArray(parsed.results)) return [];

    const sources: ResearchSource[] = [];

    for (const entry of parsed.results) {
      const url = typeof entry.url === 'string' ? entry.url : undefined;
      if (!url) continue;

      const title = typeof entry.title === 'string' ? entry.title : 'Research Source';
      const snippet = typeof entry.snippet === 'string' ? entry.snippet : undefined;
      const publishedDate = typeof entry.publishedDate === 'string' ? entry.publishedDate : undefined;
      const relevanceScore = typeof entry.score === 'number' ? entry.score : undefined;

      sources.push({
        url,
        title,
        snippet,
        publishedDate,
        relevanceScore,
        sourceType: 'web_search',
        domain: extractDomain(url),
      });
    }

    return sources;
  }

  private async buildReport(args: {
    files: Record<string, string>;
    artifactRoot: string;
    fallbackSummary: unknown;
    sources: ResearchSource[];
  }): Promise<InstitutionalResearchReport> {
    const { files, artifactRoot, fallbackSummary, sources } = args;

    const finalReportPath = path.join(artifactRoot, 'final_report.json');
    const diskReport = await this.readJsonIfPresent(finalReportPath);
    if (diskReport && isInstitutionalResearchReport(diskReport)) {
      return {
        ...diskReport,
        sources,
      };
    }

    const fileReport = parseMaybeJson<unknown>(files['/final_report.json'] ?? files['final_report.json'] ?? '');
    if (fileReport && isInstitutionalResearchReport(fileReport)) {
      return {
        ...fileReport,
        sources,
      };
    }

    return this.buildFallbackReport(files, fallbackSummary, sources);
  }

  private async readJsonIfPresent(filePath: string): Promise<unknown | undefined> {
    try {
      const content = await readFile(filePath, 'utf8');
      return parseMaybeJson<unknown>(content);
    } catch {
      return undefined;
    }
  }

  private buildFallbackReport(
    files: Record<string, string>,
    fallbackSummary: unknown,
    sources: ResearchSource[],
  ): InstitutionalResearchReport {
    const summary = typeof fallbackSummary === 'string'
      ? fallbackSummary
      : JSON.stringify(fallbackSummary ?? 'No summary generated');

    const get = (...keys: string[]): string => {
      for (const key of keys) {
        if (files[key]) return files[key]!;
      }
      return 'No section generated.';
    };

    return {
      executiveSummary: summary,
      companySnapshot: get('/subagents/business_model.md', 'subagents/business_model.md'),
      industryAndMarketStructure: get('/subagents/market_size_structure.md', 'subagents/market_size_structure.md'),
      businessModelAndUnitEconomics: get('/subagents/business_model.md', 'subagents/business_model.md'),
      financialQualityAndTrendAnalysis: get('/subagents/financial_statements.md', 'subagents/financial_statements.md'),
      capitalAllocationReview: get('/subagents/capital_allocation.md', 'subagents/capital_allocation.md'),
      valuationRelative: get('/subagents/valuation_multiples.md', 'subagents/valuation_multiples.md'),
      valuationIntrinsic: get('/subagents/valuation_intrinsic.md', 'subagents/valuation_intrinsic.md'),
      competitivePositionAndMoat: get('/subagents/competitive_landscape.md', 'subagents/competitive_landscape.md'),
      managementGovernanceAssessment: get('/subagents/management_governance.md', 'subagents/management_governance.md'),
      regulatoryAndLegalRisk: get('/subagents/regulatory_legal.md', 'subagents/regulatory_legal.md'),
      bullCase: get('/subagents/bull_thesis.md', 'subagents/bull_thesis.md'),
      bearCase: get('/subagents/bear_thesis.md', 'subagents/bear_thesis.md'),
      scenarioFramework: [
        {
          label: 'Base Case',
          assumptions: ['Revenue grows near consensus', 'Margins stabilize around recent average'],
          implications: ['Moderate upside if execution remains steady'],
        },
        {
          label: 'Bull Case',
          assumptions: ['Faster market share gains', 'Operating leverage improves margins'],
          implications: ['Significant upside with re-rating potential'],
        },
        {
          label: 'Bear Case',
          assumptions: ['Demand softening and pricing pressure', 'Execution misses on key initiatives'],
          implications: ['Downside from earnings compression and de-rating'],
        },
      ],
      catalystCalendar: get('/subagents/news_catalysts.md', 'subagents/news_catalysts.md'),
      portfolioConstructionView: get('/subagents/portfolio_fit.md', 'subagents/portfolio_fit.md'),
      investmentConclusion: get('/final_report.md', 'final_report.md'),
      evidenceIndex: sources.slice(0, 50).map((source) => ({
        claim: `Reference evidence from ${source.title}`,
        citations: [source.url],
      })),
      auditReport: {
        status: 'pass_with_caveats',
        checkedClaims: sources.length,
        unresolvedClaims: [],
        notes: ['Structured JSON report was missing; fallback synthesis was used.'],
      },
      sources,
    };
  }

  private calculateSourceMetrics(sources: ResearchSource[]): {
    uniqueSources: number;
    domainCount: number;
    recentSourceCount: number;
  } {
    const domains = new Set<string>();
    for (const source of sources) {
      const domain = source.domain ?? extractDomain(source.url);
      if (domain) domains.add(domain);
    }

    return {
      uniqueSources: sources.length,
      domainCount: domains.size,
      recentSourceCount: sources.filter((source) => isRecentDate(source.publishedDate)).length,
    };
  }

  private async storeInVectorDB(job: ResearchJob): Promise<void> {
    if (!job.result) return;

    if (!config.isVectorDbAvailable) {
      return;
    }

    const db = getDb();

    await db
      .insert(researchJobs)
      .values({
        id: job.id,
        userId: job.userId,
        query: job.query,
        status: job.status,
        result: job.result,
        metadata: job.metadata ?? {},
        error: job.error ?? null,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      })
      .onConflictDoUpdate({
        target: researchJobs.id,
        set: {
          userId: job.userId,
          query: job.query,
          status: job.status,
          result: job.result,
          metadata: job.metadata ?? {},
          error: job.error ?? null,
          updatedAt: new Date(),
        },
      });

    await db.delete(sourceTable).where(eq(sourceTable.jobId, job.id));

    if (job.result.sources.length > 0) {
      await db.insert(sourceTable).values(
        job.result.sources.map((source) => ({
          userId: job.userId,
          jobId: job.id,
          url: source.url,
          title: source.title,
          snippet: source.snippet ?? null,
          relevanceScore: source.relevanceScore !== undefined ? Math.round(source.relevanceScore * 100) : null,
        })),
      );
    }
  }

  registerWebSocket(jobId: string, ws: WebSocketLike): void {
    if (!this.wsConnections.has(jobId)) {
      this.wsConnections.set(jobId, new Set());
    }
    this.wsConnections.get(jobId)!.add(ws);
  }

  unregisterWebSocket(jobId: string, ws: WebSocketLike): void {
    const connections = this.wsConnections.get(jobId);
    if (connections) {
      connections.delete(ws);
      if (connections.size === 0) {
        this.wsConnections.delete(jobId);
      }
    }
  }

  private broadcastToJob(jobId: string, message: WebSocketMessage): void {
    const connections = this.wsConnections.get(jobId);
    if (connections) {
      const data = JSON.stringify(message);
      connections.forEach((ws) => {
        ws.send(data);
      });
    }
  }

  getJob(jobId: string): ResearchJob | undefined {
    return this.jobs.get(jobId);
  }

  getAllJobs(): ResearchJob[] {
    return Array.from(this.jobs.values());
  }
}

export const researchService = new ResearchService();
