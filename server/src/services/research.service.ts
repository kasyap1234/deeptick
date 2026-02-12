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
import { db } from '../db/connection.js';
import { researchJobs, sources as sourceTable } from '../db/schema.js';
import { embeddingService } from './embedding.service.js';
import { vectorStoreService } from './vector-store.service.js';
import { createResearchAgent } from './deep-research/agent-factory.js';

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
const MAX_SECTION_CHARS = 5000;
const MAX_FILE_CHARS = 2500;
const MAX_SOURCE_CHARS = 1000;

function chunkText(content: string, maxChars: number): string[] {
  if (content.length <= maxChars) return [content];
  const chunks: string[] = [];
  for (let i = 0; i < content.length; i += maxChars) {
    chunks.push(content.slice(i, i + maxChars));
  }
  return chunks;
}

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

export class ResearchService {
  private jobs: Map<string, ResearchJob> = new Map();
  private wsConnections: Map<string, Set<WebSocketLike>> = new Map();

  async createResearchJob(request: ResearchRequest): Promise<ResearchJob> {
    const id = crypto.randomUUID();
    const job: ResearchJob = {
      id,
      query: request.query,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.jobs.set(id, job);

    this.executeResearch(id, request).catch((error) => {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.updatedAt = new Date();

      this.broadcastToJob(id, {
        type: 'error',
        jobId: id,
        payload: { error: job.error },
        timestamp: new Date(),
      });
    });

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
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = 'in_progress';
    job.updatedAt = new Date();

    this.broadcastToJob(jobId, {
      type: 'status',
      jobId,
      payload: { status: 'in_progress' },
      timestamp: new Date(),
    });

    this.broadcastStage(jobId, 'planning');

    const startTime = Date.now();

    try {
      const { agent, artifactRoot, modelConfig } = await createResearchAgent(jobId);

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
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.updatedAt = new Date();

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

    const queryEmbedding = await embeddingService.embedQuery(job.query);

    await db
      .insert(researchJobs)
      .values({
        id: job.id,
        query: job.query,
        queryEmbedding,
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
          query: job.query,
          queryEmbedding,
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
          jobId: job.id,
          url: source.url,
          title: source.title,
          snippet: source.snippet ?? null,
          relevanceScore: source.relevanceScore !== undefined ? Math.round(source.relevanceScore * 100) : null,
        })),
      );
    }

    const chunks = this.collectEmbeddingChunks(job);
    const embeddedChunks = await embeddingService.embedResearchChunks(chunks);

    await vectorStoreService.deleteJobEmbeddings(job.id);
    await vectorStoreService.storeContentEmbeddings(job.id, embeddedChunks);
  }

  private collectEmbeddingChunks(job: ResearchJob): Array<{
    content: string;
    source?: string;
    sourceType?: 'web_search' | 'report_section' | 'chat_message';
    metadata?: Record<string, unknown>;
  }> {
    if (!job.result) return [];

    const chunks: Array<{
      content: string;
      source?: string;
      sourceType?: 'web_search' | 'report_section' | 'chat_message';
      metadata?: Record<string, unknown>;
    }> = [];

    const report = job.result;
    const reportSections: Array<[string, string]> = [
      ['executive_summary', report.executiveSummary],
      ['company_snapshot', report.companySnapshot],
      ['industry_market_structure', report.industryAndMarketStructure],
      ['business_model_unit_economics', report.businessModelAndUnitEconomics],
      ['financial_quality_trend_analysis', report.financialQualityAndTrendAnalysis],
      ['capital_allocation_review', report.capitalAllocationReview],
      ['valuation_relative', report.valuationRelative],
      ['valuation_intrinsic', report.valuationIntrinsic],
      ['competitive_position_moat', report.competitivePositionAndMoat],
      ['management_governance_assessment', report.managementGovernanceAssessment],
      ['regulatory_legal_risk', report.regulatoryAndLegalRisk],
      ['bull_case', report.bullCase],
      ['bear_case', report.bearCase],
      ['catalyst_calendar', report.catalystCalendar],
      ['portfolio_construction_view', report.portfolioConstructionView],
      ['investment_conclusion', report.investmentConclusion],
    ];

    for (const [section, content] of reportSections) {
      const text = content.trim();
      if (!text) continue;
      const split = chunkText(text, MAX_SECTION_CHARS);
      split.forEach((part, index) => {
        chunks.push({
          content: `[${section}] ${part}`,
          source: `section:${section}`,
          sourceType: 'report_section' as const,
          metadata: { section, chunkIndex: index, chunkCount: split.length },
        });
      });
    }

    const scenarioText = JSON.stringify(report.scenarioFramework);
    if (scenarioText.length > 2) {
      const split = chunkText(scenarioText, MAX_SECTION_CHARS);
      split.forEach((part, index) => {
        chunks.push({
          content: `[scenario_framework] ${part}`,
          source: 'section:scenario_framework',
          sourceType: 'report_section',
          metadata: { section: 'scenarioFramework', chunkIndex: index, chunkCount: split.length },
        });
      });
    }

    const evidenceText = JSON.stringify(report.evidenceIndex);
    if (evidenceText.length > 2) {
      const split = chunkText(evidenceText, MAX_SECTION_CHARS);
      split.forEach((part, index) => {
        chunks.push({
          content: `[evidence_index] ${part}`,
          source: 'section:evidence_index',
          sourceType: 'report_section',
          metadata: { section: 'evidenceIndex', chunkIndex: index, chunkCount: split.length },
        });
      });
    }

    for (const source of report.sources) {
      const sourceContent = [
        source.title,
        source.snippet,
        `URL: ${source.url}`,
      ].filter(Boolean).join('\n');

      if (!sourceContent.trim()) continue;

      const split = chunkText(sourceContent, MAX_SOURCE_CHARS);
      split.forEach((part, index) => {
        chunks.push({
          content: part,
          source: source.url,
          sourceType: 'web_search',
          metadata: {
            publishedDate: source.publishedDate,
            domain: source.domain,
            chunkIndex: index,
            chunkCount: split.length,
          },
        });
      });
    }

    const files = job.metadata?.files ?? {};
    for (const [filePath, fileContent] of Object.entries(files)) {
      const text = fileContent.trim();
      if (!text) continue;
      const split = chunkText(text, MAX_FILE_CHARS);
      split.forEach((part, index) => {
        chunks.push({
          content: `[artifact:${filePath}] ${part}`,
          source: `artifact:${filePath}`,
          sourceType: 'report_section',
          metadata: { artifact: filePath, chunkIndex: index, chunkCount: split.length },
        });
      });
    }

    return chunks;
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
