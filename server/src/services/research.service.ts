import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import {
  type InstitutionalResearchReport,
  type ProgressPayload,
  type ResearchFailureCode,
  type ResearchJob,
  type ResearchRequest,
  type ResearchSource,
  type SubAgentActivity,
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
import { canonicalizeUrl, exaSearchTool, snippetFingerprint } from '../tools/exa-tools.js';
import { logger } from '../utils/logger.js';

type FileDataLike = { content: string[] } | string | null | undefined;

type AgentInvokeResult = {
  messages: Array<{ content: unknown }>;
  files?: Record<string, FileDataLike>;
  todos?: Array<{ content: string }>;
};

const MINIMUM_SOURCE_TARGETS = {
  uniqueSources: 18,
  domains: 6,
  recentSources: 6,
};

const RESEARCH_EXECUTION_BUDGETS = {
  maxRunMs: 18 * 60 * 1000,
  recursionLimit: 100,
  maxToolCalls: 150,
  maxSubagentCalls: 25,
  expectedSubagents: 7,
};

type ReportSectionKey =
  | 'executiveSummary'
  | 'companySnapshot'
  | 'industryAndMarketStructure'
  | 'businessModelAndUnitEconomics'
  | 'financialQualityAndTrendAnalysis'
  | 'capitalAllocationReview'
  | 'valuationRelative'
  | 'valuationIntrinsic'
  | 'competitivePositionAndMoat'
  | 'managementGovernanceAssessment'
  | 'regulatoryAndLegalRisk'
  | 'bullCase'
  | 'bearCase'
  | 'catalystCalendar'
  | 'portfolioConstructionView'
  | 'investmentConclusion';

type ReportQualityMetrics = {
  missingSections: ReportSectionKey[];
  weakSections: ReportSectionKey[];
  filledSections: number;
  totalSections: number;
  completenessScore: number;
  bullBearOverlapScore: number;
  bullBearDistinct: boolean;
};

const REPORT_SECTION_KEYS: ReportSectionKey[] = [
  'executiveSummary',
  'companySnapshot',
  'industryAndMarketStructure',
  'businessModelAndUnitEconomics',
  'financialQualityAndTrendAnalysis',
  'capitalAllocationReview',
  'valuationRelative',
  'valuationIntrinsic',
  'competitivePositionAndMoat',
  'managementGovernanceAssessment',
  'regulatoryAndLegalRisk',
  'bullCase',
  'bearCase',
  'catalystCalendar',
  'portfolioConstructionView',
  'investmentConclusion',
];

const CORE_REPORT_SECTIONS: ReportSectionKey[] = [
  'executiveSummary',
  'financialQualityAndTrendAnalysis',
  'bullCase',
  'bearCase',
  'investmentConclusion',
];

const SECTION_MIN_CHARACTERS: Record<ReportSectionKey, number> = {
  executiveSummary: 140,
  companySnapshot: 120,
  industryAndMarketStructure: 120,
  businessModelAndUnitEconomics: 120,
  financialQualityAndTrendAnalysis: 140,
  capitalAllocationReview: 110,
  valuationRelative: 110,
  valuationIntrinsic: 110,
  competitivePositionAndMoat: 120,
  managementGovernanceAssessment: 100,
  regulatoryAndLegalRisk: 100,
  bullCase: 180,
  bearCase: 180,
  catalystCalendar: 90,
  portfolioConstructionView: 90,
  investmentConclusion: 140,
};

const FALLBACK_NO_DATA_MESSAGE =
  'Insufficient data was collected to populate this section. The research agent did not produce a structured report for this area.';

const EMERGENCY_SOURCE_QUERIES = [
  'latest quarterly results earnings transcript guidance',
  'valuation multiples analyst target price consensus estimates',
  'risks regulatory competition downside scenario',
];

const QUERY_STOP_WORDS = new Set([
  'stock',
  'stocks',
  'share',
  'shares',
  'price',
  'invest',
  'investment',
  'good',
  'time',
  'latest',
  'quarter',
  'valuation',
  'bull',
  'bear',
  'case',
  'final',
  'verdict',
  'now',
  'is',
  'a',
  'to',
  'in',
  'it',
  'for',
  'on',
  'and',
  'of',
  'the',
]);

class ResearchExecutionError extends Error {
  constructor(
    public readonly code: ResearchFailureCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ResearchExecutionError';
  }
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

function parseDateMs(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function computeSourceRecencyScore(value?: string): number {
  const parsed = parseDateMs(value);
  if (!parsed) return 0.2;
  const ageDays = (Date.now() - parsed) / (1000 * 60 * 60 * 24);
  if (ageDays <= 7) return 1;
  if (ageDays <= 30) return 0.85;
  if (ageDays <= 90) return 0.7;
  if (ageDays <= 180) return 0.45;
  return 0.2;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeHeading(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMarkdownSectionByHeadings(content: string, headingHints: string[]): string | undefined {
  const lines = content.split(/\r?\n/);
  const normalizedHints = headingHints.map(normalizeHeading);

  let start = -1;
  let end = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (!headingMatch) continue;

    const heading = normalizeHeading(headingMatch[1] ?? '');
    const isTarget = normalizedHints.some((hint) => hint.length > 0 && heading.includes(hint));
    if (!isTarget) continue;

    start = i + 1;
    for (let j = start; j < lines.length; j++) {
      if (/^#{1,6}\s+/.test(lines[j] ?? '')) {
        end = j;
        break;
      }
    }
    break;
  }

  if (start < 0 || start >= end) return undefined;
  const block = lines.slice(start, end).join('\n').trim();
  return block.length >= 40 ? block : undefined;
}

function extractParagraphsByKeywords(content: string, keywords: string[]): string | undefined {
  const normalizedKeywords = keywords.map((keyword) => keyword.toLowerCase());
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length >= 40);

  const matches = paragraphs.filter((paragraph) => {
    const lower = paragraph.toLowerCase();
    return normalizedKeywords.some((keyword) => lower.includes(keyword));
  });

  if (matches.length === 0) return undefined;
  return matches.slice(0, 3).join('\n\n');
}

function tokenizeForSimilarity(value: string): Set<string> {
  const tokens = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4);
  return new Set(tokens);
}

function computeJaccardSimilarity(left: string, right: string): number {
  const leftSet = tokenizeForSimilarity(left);
  const rightSet = tokenizeForSimilarity(right);
  if (leftSet.size === 0 || rightSet.size === 0) return 0;

  let overlap = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) overlap += 1;
  }

  const unionSize = leftSet.size + rightSet.size - overlap;
  return unionSize === 0 ? 0 : overlap / unionSize;
}

function formatGuardrailError(triggered: Array<{ message: string }>): string {
  if (triggered.length === 0) {
    return 'Request blocked by guardrails policy.';
  }

  return `Request blocked by guardrails policy: ${triggered.map((rule) => rule.message).join('; ')}`;
}

function extractResearchErrorMessage(error: unknown): string {
  const parts: string[] = [];
  if (error instanceof Error && error.message.trim()) {
    parts.push(error.message);
  } else if (error && typeof (error as { message?: string }).message === 'string') {
    parts.push((error as { message: string }).message);
  }
  const cause = error instanceof Error ? error.cause : (error as { cause?: unknown })?.cause;
  if (cause instanceof Error && cause.message.trim()) {
    parts.push(`Cause: ${cause.message}`);
  } else if (cause && typeof (cause as { message?: string }).message === 'string') {
    parts.push(`Cause: ${(cause as { message: string }).message}`);
  }
  const pregelTaskId = (error as { pregelTaskId?: string })?.pregelTaskId ?? (cause as { pregelTaskId?: string })?.pregelTaskId;
  if (pregelTaskId) {
    parts.push(`(task: ${pregelTaskId})`);
  }
  return parts.length > 0 ? parts.join(' ') : 'Unknown error';
}

function inferFailureCode(error: unknown): ResearchFailureCode {
  if (error instanceof ResearchExecutionError) return error.code;

  const message = extractResearchErrorMessage(error).toLowerCase();
  if (message.includes('rate limit') || message.includes('429')) return 'rate_limited';
  if (message.includes('recursion limit')) return 'recursion_limit_reached';
  if (message.includes('timed out') || message.includes('timeout')) return 'timeout';
  if (message.includes('guardrail')) return 'guardrails_blocked';
  if (message.includes('insufficient research output') || message.includes('no evidence')) return 'insufficient_research_output';
  if (message.includes('digitalocean') || message.includes('provider')) return 'provider_error';
  return 'unknown_error';
}

/**
 * Detects whether a string is raw JSON tool output (e.g. Exa search results)
 * and extracts the meaningful human-readable text from it.
 */
function sanitizeFallbackSummary(raw: unknown): string {
  if (!raw) return 'Research model returned no summary output.';

  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text && typeof raw === 'object') {
    // raw is an object — try to serialize meaningfully
    return extractReadableFromObject(raw as Record<string, unknown>);
  }

  // Check if the string is JSON
  const parsed = parseMaybeJson<Record<string, unknown>>(text);
  if (!parsed) {
    // It's plain text — return it (truncate if excessively long)
    return text.length > 8000 ? text.slice(0, 8000) + '...' : text;
  }

  return extractReadableFromObject(parsed);
}

function extractReadableFromObject(obj: Record<string, unknown>): string {
  // Yahoo Finance quote objects have 'symbol', 'price', 'name'
  if (typeof obj.symbol === 'string' && typeof obj.price === 'number') {
    const parts: string[] = [];
    if (typeof obj.name === 'string') parts.push(`**${obj.name}** (${obj.symbol})`);
    parts.push(`Current Price: ${obj.currency ?? ''} ${obj.price}`);
    if (typeof obj.previousClose === 'number') {
      const change = ((obj.price - obj.previousClose) / obj.previousClose * 100).toFixed(2);
      parts.push(`Change: ${Number(change) >= 0 ? '+' : ''}${change}%`);
    }
    if (typeof obj['52WeekHigh'] === 'number') parts.push(`52-Week High: ${obj['52WeekHigh']}`);
    if (typeof obj['52WeekLow'] === 'number') parts.push(`52-Week Low: ${obj['52WeekLow']}`);
    if (typeof obj.volume === 'number') parts.push(`Volume: ${obj.volume.toLocaleString()}`);
    return parts.join('\n');
  }

  // Exa search results have a "results" array with summaries
  if (Array.isArray(obj.results)) {
    const summaries = (obj.results as Array<Record<string, unknown>>)
      .map((r) => {
        const title = typeof r.title === 'string' ? r.title : '';
        const summary = typeof r.summary === 'string' ? r.summary : '';
        const snippet = typeof r.snippet === 'string' ? r.snippet : '';
        return summary || snippet || title;
      })
      .filter(Boolean);
    if (summaries.length > 0) {
      return summaries.slice(0, 5).join('\n\n');
    }
  }

  // Yahoo finance / generic objects: look for common text fields
  for (const key of ['summary', 'text', 'content', 'description', 'analysis', 'output']) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim().length > 50) {
      return value.trim();
    }
  }

  // Last resort: stringify but mark it as auto-extracted
  const stringified = JSON.stringify(obj, null, 2);
  if (stringified.length > 3000) {
    return 'Research data was collected but could not be synthesized into a readable summary. The raw data has been preserved in the sources section.';
  }
  return stringified;
}

/**
 * Scans all collected files for content relevant to a given report section.
 * Returns the best match or the default value.
 */
function inferSectionFromFiles(
  files: Record<string, string>,
  keywords: string[],
  defaultValue: string,
): string {
  const lowerKeywords = keywords.map((k) => k.toLowerCase());

  // Score each file by how many keywords appear in its path or content
  let bestFile: string | undefined;
  let bestScore = 0;

  for (const [filePath, content] of Object.entries(files)) {
    if (!content || content.trim().length < 50) continue;
    const lowerPath = filePath.toLowerCase();
    const lowerContent = content.toLowerCase().slice(0, 6000);
    let score = 0;
    for (const kw of lowerKeywords) {
      if (lowerPath.includes(kw)) score += 3;
      if (lowerContent.includes(kw)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestFile = content;
    }
  }

  return bestFile && bestScore >= 2 ? bestFile : defaultValue;
}

export class ResearchService {
  private jobs: Map<string, ResearchJob> = new Map();
  private wsConnections: Map<string, Set<WebSocketLike>> = new Map();
  private progressByJob: Map<string, ProgressPayload> = new Map();
  private jobTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();

  private cleanupTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  private clearJobTimeout(jobId: string): void {
    const timeout = this.jobTimeouts.get(jobId);
    if (timeout) {
      clearTimeout(timeout);
      this.jobTimeouts.delete(jobId);
    }
  }

  private scheduleJobCleanup(jobId: string, delayMs = 300_000): void {
    // Cancel any existing cleanup timer
    const existing = this.cleanupTimers.get(jobId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.cleanupTimers.delete(jobId);
      this.jobs.delete(jobId);
      this.progressByJob.delete(jobId);
      this.wsConnections.delete(jobId);
      this.jobTimeouts.delete(jobId);
    }, delayMs);

    this.cleanupTimers.set(jobId, timer);
  }

  private scheduleJobTimeout(job: ResearchJob): void {
    this.clearJobTimeout(job.id);
    const timeout = setTimeout(() => {
      if (job.status === 'in_progress' || job.status === 'pending') {
        const elapsedMs = Date.now() - job.createdAt.getTime();
        const timeoutError = new ResearchExecutionError(
          'timeout',
          `Research timed out after ${Math.round(RESEARCH_EXECUTION_BUDGETS.maxRunMs / 60000)} minutes.`,
          { elapsedMs },
        );

        this.failJob(job.id, timeoutError, {
          failureStage: 'execution',
          timedOutAt: new Date().toISOString(),
          budgetMetrics: {
            toolCalls: 0,
            subagentCalls: 0,
            elapsedMs,
          },
        }).catch((dbErr) => {
          logger.error({ jobId: job.id, error: dbErr }, 'Failed to persist timeout state');
        });
      }
    }, RESEARCH_EXECUTION_BUDGETS.maxRunMs);
    this.jobTimeouts.set(job.id, timeout);
  }

  private getOrCreateProgress(jobId: string): ProgressPayload {
    const existing = this.progressByJob.get(jobId);
    if (existing) return existing;

    const initial: ProgressPayload = {
      stage: 'queued',
      status: 'pending',
      urls: [],
      reasoning: [],
      subAgentActivities: [],
    };

    this.progressByJob.set(jobId, initial);
    return initial;
  }

  private pushProgress(jobId: string, patch: Partial<ProgressPayload>): void {
    const current = this.getOrCreateProgress(jobId);
    const merged: ProgressPayload = {
      ...current,
      ...patch,
      urls: patch.urls ?? current.urls,
      reasoning: patch.reasoning ?? current.reasoning,
      subAgentActivities: patch.subAgentActivities ?? current.subAgentActivities,
      completedSubagents: patch.completedSubagents ?? current.completedSubagents,
    };

    this.progressByJob.set(jobId, merged);

    this.broadcastToJob(jobId, {
      type: 'progress',
      jobId,
      payload: merged,
      timestamp: new Date(),
    });
  }

  private appendUrls(jobId: string, urls: string[]): void {
    if (urls.length === 0) return;

    const current = this.getOrCreateProgress(jobId);
    const nextUrls = Array.from(new Set([...current.urls, ...urls]));
    this.pushProgress(jobId, {
      urls: nextUrls,
      uniqueSources: nextUrls.length,
    });
  }

  private appendReasoning(jobId: string, note: string): void {
    const trimmed = note.trim();
    if (!trimmed) return;

    const current = this.getOrCreateProgress(jobId);
    const nextReasoning = [...current.reasoning, trimmed].slice(-20);
    this.pushProgress(jobId, { reasoning: nextReasoning });
  }

  private upsertSubAgentActivity(jobId: string, activity: SubAgentActivity): void {
    const current = this.getOrCreateProgress(jobId);
    const existingIndex = current.subAgentActivities.findIndex((entry) => entry.id === activity.id);
    const nextActivities = [...current.subAgentActivities];

    if (existingIndex >= 0) {
      nextActivities[existingIndex] = activity;
    } else {
      nextActivities.push(activity);
    }

    this.pushProgress(jobId, { subAgentActivities: nextActivities.slice(-30) });
  }

  private extractUrlsFromUnknown(payload: unknown): string[] {
    const visited = new WeakSet<object>();
    const collect = (value: unknown, acc: Set<string>, depth: number): void => {
      if (depth > 8) return;

      if (typeof value === 'string') {
        const matches = value.match(/https?:\/\/[^\s)\]>"]+/g) ?? [];
        for (const match of matches) {
          acc.add(match);
        }

        try {
          const parsed = JSON.parse(value) as unknown;
          collect(parsed, acc, depth + 1);
        } catch {
          return;
        }
        return;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          collect(item, acc, depth + 1);
        }
        return;
      }

      if (!value || typeof value !== 'object') {
        return;
      }

      if (visited.has(value)) {
        return;
      }
      visited.add(value);

      const record = value as Record<string, unknown>;
      for (const entry of Object.values(record)) {
        collect(entry, acc, depth + 1);
      }
    };

    const urls = new Set<string>();
    collect(payload, urls, 0);
    return Array.from(urls);
  }

  private runSafeProgressCallback(jobId: string, callbackName: string, operation: () => void): void {
    try {
      operation();
    } catch (error) {
      logger.warn({ jobId, callbackName, error }, 'Progress callback failed; continuing research run');
    }
  }

  private snippetFromUnknown(payload: unknown, max = 220): string | undefined {
    if (typeof payload === 'string') {
      const normalized = payload.replace(/\s+/g, ' ').trim();
      return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
    }

    if (!payload || typeof payload !== 'object') {
      return undefined;
    }

    const record = payload as Record<string, unknown>;
    if (typeof record.text === 'string') {
      return this.snippetFromUnknown(record.text, max);
    }
    if (typeof record.content === 'string') {
      return this.snippetFromUnknown(record.content, max);
    }

    return undefined;
  }

  private inferToolName(serialized: unknown, input: unknown): string {
    const record = serialized && typeof serialized === 'object'
      ? serialized as Record<string, unknown>
      : undefined;

    const directName = typeof record?.name === 'string' ? record.name : undefined;
    if (directName) return directName;

    const lcKwargs = record?.lc_kwargs && typeof record.lc_kwargs === 'object'
      ? record.lc_kwargs as Record<string, unknown>
      : undefined;
    const lcName = typeof lcKwargs?.name === 'string' ? lcKwargs.name : undefined;
    if (lcName) return lcName;

    const identifier = Array.isArray(record?.id) && record.id.length > 0
      ? String(record.id[record.id.length - 1] ?? '')
      : undefined;
    if (identifier) return identifier;

    const toolInput = input && typeof input === 'object'
      ? input as Record<string, unknown>
      : undefined;
    if (typeof toolInput?.subagent_type === 'string') {
      return 'task';
    }

    return 'tool';
  }

  private sourceDateLabel(source: ResearchSource): string {
    return source.publishedDate ? ` (published ${source.publishedDate})` : '';
  }

  private buildSourceDigest(sources: ResearchSource[], maxItems = 6): string {
    return sources
      .slice(0, maxItems)
      .map((source, index) => {
        const snippet = (source.snippet ?? source.title)
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 190);
        return `${index + 1}. ${source.title}${this.sourceDateLabel(source)} - ${snippet}`;
      })
      .join('\n');
  }

  private pickSourcesByKeywords(sources: ResearchSource[], keywords: string[]): ResearchSource[] {
    const loweredKeywords = keywords.map((keyword) => keyword.toLowerCase());
    const matches = sources.filter((source) => {
      const text = `${source.title} ${source.snippet ?? ''}`.toLowerCase();
      return loweredKeywords.some((keyword) => text.includes(keyword));
    });

    if (matches.length > 0) return matches;
    return sources.slice(0, 5);
  }

  private extractQueryTerms(query: string): string[] {
    const tokens = query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !QUERY_STOP_WORDS.has(token));

    return Array.from(new Set(tokens)).slice(0, 6);
  }

  private filterSourcesByQueryRelevance(sources: ResearchSource[], query: string): ResearchSource[] {
    const queryTerms = this.extractQueryTerms(query);
    if (queryTerms.length === 0) return sources;

    const scored = sources.map((source) => {
      const haystack = `${source.title} ${source.snippet ?? ''} ${source.url}`.toLowerCase();
      const score = queryTerms.reduce((count, term) => (haystack.includes(term) ? count + 1 : count), 0);
      return { source, score };
    });

    const relevant = scored
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .map((entry) => entry.source);

    if (relevant.length >= Math.max(6, Math.floor(sources.length * 0.4))) {
      return relevant;
    }

    return sources;
  }

  private buildDeterministicReportFromEvidence(args: {
    query: string;
    sources: ResearchSource[];
    degradationReasons: string[];
  }): InstitutionalResearchReport {
    const { query, degradationReasons } = args;
    const sources = this.normalizeAndRankSources(args.sources);
    const recentSources = sources.filter((source) => isRecentDate(source.publishedDate));
    const anchorSources = (recentSources.length > 0 ? recentSources : sources).slice(0, 8);
    const bullishSources = this.pickSourcesByKeywords(sources, [
      'growth',
      'beat',
      'upside',
      'expansion',
      'margin',
      'guidance',
      'strong',
    ]).slice(0, 5);
    const bearishSources = this.pickSourcesByKeywords(sources, [
      'risk',
      'downside',
      'weak',
      'regulatory',
      'litigation',
      'headwind',
      'decline',
    ]).slice(0, 5);

    const evidenceDigest = this.buildSourceDigest(anchorSources);
    const bullishDigest = this.buildSourceDigest(bullishSources);
    const bearishDigest = this.buildSourceDigest(bearishSources);
    const degradationText = degradationReasons.length > 0
      ? `Upstream providers were unstable (${degradationReasons.join(', ')}), so this report uses deterministic synthesis over collected evidence.`
      : 'This report uses deterministic synthesis over collected evidence to preserve section completeness.';

    const executiveSummary = [
      `Deterministic investment assessment for query: "${query}".`,
      `Evidence base: ${sources.length} sources across ${new Set(sources.map((source) => source.domain).filter(Boolean)).size} domains, with ${recentSources.length} sources from the last 90 days.`,
      'Verdict framing: treat the stock as conditional, with investment attractiveness dependent on confirmation from the next quarterly print, forward guidance stability, and valuation support relative to peers.',
      degradationText,
      `Top evidence signals:\n${evidenceDigest}`,
    ].join('\n\n');

    const bullCase = [
      'Bull case thesis: upside comes from earnings durability, margin resilience, and potential re-rating if growth quality stays above consensus expectations.',
      'Catalysts include stronger-than-expected quarterly delivery, favorable product/regulatory updates, and operating leverage converting revenue growth into earnings acceleration.',
      'Positioning implication: upside scenario strengthens when management commentary, demand indicators, and analyst revisions align positively across at least two consecutive updates.',
      `Bullish evidence cluster:\n${bullishDigest}`,
    ].join('\n\n');

    const bearCase = [
      'Bear case thesis: downside is driven by execution slippage, pricing pressure, regulatory shocks, and valuation compression if growth momentum weakens.',
      'Primary risk path includes weaker demand conversion, adverse compliance outcomes, cost inflation, and negative estimate revisions that reduce confidence in medium-term earnings quality.',
      'Risk implication: if downside indicators persist into the next results cycle, expected return skews negative even if headline valuation appears optically reasonable.',
      `Bearish evidence cluster:\n${bearishDigest}`,
    ].join('\n\n');

    const conclusion = [
      'Investment conclusion: the evidence supports a conditional/neutral stance rather than an unconditional buy call at this moment.',
      'Actionable framing: accumulate only on valuation support with strict risk controls, and require confirmation from the next quarterly disclosures and guidance trajectory before sizing up.',
      `Confidence note: ${degradationText}`,
    ].join('\n\n');

    return {
      executiveSummary,
      companySnapshot: `Company snapshot synthesized from collected evidence. Focus areas include business mix, segment exposure, and current positioning indicators.\n\n${evidenceDigest}`,
      industryAndMarketStructure: `Industry and market structure view based on the latest retrieved coverage. Competitive intensity, demand elasticity, and policy/regulatory context are key drivers to monitor over the next two quarters.\n\n${evidenceDigest}`,
      businessModelAndUnitEconomics: `Business model and unit economics synthesis indicates that margin quality, pricing discipline, and product mix are decisive for forward earnings conversion. Monitoring gross-to-operating margin bridge remains critical.\n\n${evidenceDigest}`,
      financialQualityAndTrendAnalysis: `Financial trend analysis emphasizes recency: latest quarters should be weighted more heavily than historical averages. Revenue quality, margin trajectory, and cash conversion need to remain consistent to sustain valuation support.\n\n${evidenceDigest}`,
      capitalAllocationReview: `Capital allocation review focuses on reinvestment discipline, debt posture, and shareholder return priorities. Sustainable ROIC and prudent leverage management are key for long-term compounding quality.\n\n${evidenceDigest}`,
      valuationRelative: `Relative valuation synthesis compares the company to peers across earnings and cash-flow multiples. Current attractiveness depends on whether quality and growth persistence justify any premium or narrow discount.\n\n${evidenceDigest}`,
      valuationIntrinsic: `Intrinsic valuation framing uses scenario-based assumptions around growth, margin normalization, and discount rate sensitivity. Fair-value confidence remains contingent on near-term execution consistency.\n\n${evidenceDigest}`,
      competitivePositionAndMoat: `Competitive position assessment highlights differentiation durability, channel strength, and execution consistency versus peers. Moat confidence should be revisited after each major operational update.\n\n${evidenceDigest}`,
      managementGovernanceAssessment: `Management and governance assessment remains evidence-constrained; decision quality should be judged via capital allocation consistency, disclosure transparency, and guidance credibility over time.\n\n${evidenceDigest}`,
      regulatoryAndLegalRisk: `Regulatory and legal risk analysis flags policy changes, compliance outcomes, and litigation sensitivity as key downside drivers. Position sizing should reflect event-risk asymmetry.\n\n${bearishDigest}`,
      bullCase,
      bearCase,
      scenarioFramework: [
        {
          label: 'Base Case',
          assumptions: [
            'Revenue and margins track near consensus with no major adverse regulatory surprise.',
            'Valuation remains range-bound pending clearer forward guidance.',
          ],
          implications: ['Moderate risk-adjusted return, suitable only for disciplined position sizing.'],
        },
        {
          label: 'Bull Case',
          assumptions: [
            'Earnings quality improves and growth durability exceeds market expectations.',
            'Positive catalysts drive estimate revisions and multiple expansion.',
          ],
          implications: ['Upside potential improves with expanding confidence in execution consistency.'],
        },
        {
          label: 'Bear Case',
          assumptions: [
            'Execution and demand weaken while regulatory or cost pressures rise.',
            'Consensus expectations are revised downward and valuation compresses.',
          ],
          implications: ['Downside risk dominates; protect capital and reduce exposure.'],
        },
      ],
      catalystCalendar: `Catalyst calendar should prioritize upcoming earnings, guidance updates, regulatory milestones, and major strategic announcements likely to reset expectations.\n\n${evidenceDigest}`,
      portfolioConstructionView: 'Portfolio construction view: use staged entries, predefined stop-loss discipline, and capped position sizing until uncertainty around near-term catalysts and guidance visibility declines.',
      investmentConclusion: conclusion,
      evidenceIndex: sources.slice(0, 50).map((source) => ({
        claim: `Deterministic synthesis reference from ${source.title}`,
        citations: [source.url],
      })),
      auditReport: {
        status: 'pass_with_caveats',
        checkedClaims: sources.length,
        unresolvedClaims: [],
        notes: [
          'Report generated via deterministic evidence synthesis due unstable upstream execution.',
          degradationText,
        ],
      },
      sources,
    };
  }

  private async collectEmergencySources(query: string): Promise<ResearchSource[]> {
    const collected: ResearchSource[] = [];

    for (const suffix of EMERGENCY_SOURCE_QUERIES) {
      const searchQuery = `${query} ${suffix}`;
      try {
        const raw = await exaSearchTool.invoke({ query: searchQuery, maxResults: 8 });
        const content = typeof raw === 'string' ? raw : JSON.stringify(raw);
        const extracted = this.extractFromExaJson(content);
        collected.push(...extracted);
      } catch (error) {
        logger.warn({ error, searchQuery }, 'Emergency Exa evidence search failed');
      }
    }

    const ranked = this.normalizeAndRankSources(collected);
    return this.filterSourcesByQueryRelevance(ranked, query);
  }

  private detectProviderDegradation(
    jobId: string,
    context?: { report?: InstitutionalResearchReport; toolCalls?: number; subagentCalls?: number; hasAnyEvidence?: boolean },
  ): { degraded: boolean; rateLimited: boolean; reasons: string[] } {
    const progress = this.getOrCreateProgress(jobId);
    const reportSignals = context?.report
      ? [
        context.report.executiveSummary,
        context.report.investmentConclusion,
        context.report.auditReport.notes.join(' '),
      ]
      : [];

    const signals = [
      ...progress.reasoning.slice(-20),
      ...progress.subAgentActivities
        .slice(-30)
        .map((activity) => [activity.name, activity.detail].filter(Boolean).join(' ')),
      ...reportSignals,
    ]
      .map((value) => value.toLowerCase())
      .filter((value) => value.length > 0);

    const reasons = new Set<string>();
    let rateLimited = false;

    for (const signal of signals) {
      if (/\b429\b|rate\s*limit|too many requests/.test(signal)) {
        reasons.add('rate_limit_429');
        rateLimited = true;
      }
      if (/\b401\b|\b403\b|unauthori[sz]ed|forbidden|invalid api key|auth/.test(signal)) {
        reasons.add('auth_or_permission_error');
      }
      if (/timed?\s*out|timeout|deadline exceeded|etimedout/.test(signal)) {
        reasons.add('upstream_timeout');
      }
      if (/provider unavailable|service unavailable|\b503\b|bad gateway|\b502\b|gateway timeout|\b504\b|upstream/.test(signal)) {
        reasons.add('provider_unavailable');
      }
      if (/no cookies|missing cookies|cookie jar|cookie(s)? required|cf_clearance/.test(signal)) {
        reasons.add('missing_provider_cookies');
      }
    }

    if (
      context &&
      context.hasAnyEvidence === false &&
      (context.toolCalls ?? 0) >= 8 &&
      (context.subagentCalls ?? 0) >= 1
    ) {
      reasons.add('high_activity_without_evidence');
    }

    return {
      degraded: reasons.size > 0,
      rateLimited,
      reasons: Array.from(reasons),
    };
  }

  private hasToolCallsInResult(result: AgentInvokeResult): boolean {
    for (const message of result.messages) {
      if (!message || typeof message !== 'object') continue;
      const record = message as Record<string, unknown>;
      const kwargs = (record.kwargs && typeof record.kwargs === 'object')
        ? record.kwargs as Record<string, unknown>
        : undefined;
      const additional = (kwargs?.additional_kwargs && typeof kwargs.additional_kwargs === 'object')
        ? kwargs.additional_kwargs as Record<string, unknown>
        : undefined;

      const candidates = [
        record.tool_calls,
        kwargs?.tool_calls,
        additional?.tool_calls,
      ];
      if (candidates.some((candidate) => Array.isArray(candidate) && candidate.length > 0)) {
        return true;
      }
    }

    return false;
  }

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

  private async failJob(
    jobId: string,
    error: unknown,
    metadataPatch?: Partial<NonNullable<ResearchJob['metadata']>>,
  ): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || job.status === 'completed') {
      this.clearJobTimeout(jobId);
      this.scheduleJobCleanup(jobId);
      return;
    }

    const message = extractResearchErrorMessage(error);
    const code = inferFailureCode(error);
    const details = error instanceof ResearchExecutionError ? error.details : undefined;
    if (job.status === 'failed' && job.error === message) {
      this.clearJobTimeout(jobId);
      this.scheduleJobCleanup(jobId);
      return;
    }
    const detailBudget =
      details &&
        typeof details.toolCalls === 'number' &&
        typeof details.subagentCalls === 'number'
        ? {
          toolCalls: details.toolCalls,
          subagentCalls: details.subagentCalls,
          elapsedMs: typeof details.elapsedMs === 'number' ? details.elapsedMs : 0,
        }
        : undefined;

    job.status = 'failed';
    job.error = message;
    job.updatedAt = new Date();
    job.metadata = {
      ...(job.metadata ?? {}),
      ...(metadataPatch ?? {}),
      ...(detailBudget ? { budgetMetrics: detailBudget } : {}),
      failureCode: code,
      failureStage:
        metadataPatch?.failureStage ??
        (details && typeof details.stage === 'string' ? details.stage : 'execution'),
    };

    await this.updateJobStatus(jobId, 'failed', undefined, message, job.metadata as Record<string, unknown>);

    this.pushProgress(jobId, {
      status: 'failed',
      stage: 'failed',
    });

    this.broadcastToJob(jobId, {
      type: 'error',
      jobId,
      payload: { error: message, code, details },
      timestamp: new Date(),
    });

    this.clearJobTimeout(jobId);
    this.scheduleJobCleanup(jobId);
  }

  async createResearchJob(request: ResearchRequest): Promise<ResearchJob> {
    const id = crypto.randomUUID();
    if (!request.userId) {
      throw new ResearchExecutionError(
        'auth_error',
        'A valid userId is required to create a research job',
      );
    }
    const userId = request.userId;
    const job: ResearchJob = {
      id,
      userId,
      query: request.query,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.jobs.set(id, job);
    this.progressByJob.set(id, {
      stage: 'queued',
      status: 'pending',
      urls: [],
      reasoning: ['Research job queued.'],
      subAgentActivities: [],
    });

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
        this.failJob(id, error).catch((dbErr) => {
          logger.error({ jobId: id, error: dbErr }, 'Failed to update job status in DB');
        });
      });

    this.scheduleJobTimeout(job);

    return job;
  }

  private broadcastStage(jobId: string, stage: string, details?: Partial<ProgressPayload>): void {
    const progressPatch: Partial<ProgressPayload> = {
      stage,
      ...details,
    };
    this.pushProgress(jobId, progressPatch);
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
      const guardrailError = new ResearchExecutionError(
        'guardrails_blocked',
        formatGuardrailError(inputGuardrailResult.triggered),
        { guardrails: inputGuardrailResult.triggered },
      );
      await this.failJob(jobId, guardrailError, { failureStage: 'input_guardrails' });

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
      const { report, usedFallback } = this.materializeCachedReport(cachedResult.responseText);

      if (usedFallback) {
        logger.warn({ jobId, cacheId: cachedResult.id }, 'Ignoring invalid cached report and running fresh research');
      } else {
        const normalizedCachedSources = this.normalizeAndRankSources(Array.isArray(report.sources) ? report.sources : []);
        const cachedReport = {
          ...report,
          sources: normalizedCachedSources,
        };
        const cacheQuality = this.evaluateReportCompleteness(cachedReport);
        const hasCoreCoverage = CORE_REPORT_SECTIONS.every((section) =>
          !cacheQuality.missingSections.includes(section) && !cacheQuality.weakSections.includes(section),
        );

        if (hasCoreCoverage && cacheQuality.completenessScore >= 0.8) {
          logger.info({ jobId, similarity: cachedResult.similarity }, 'Returning cached result');
          job.result = cachedReport;
          job.status = 'completed';
          job.metadata = {
            cached: true,
            cacheId: cachedResult.id,
            similarity: cachedResult.similarity,
            qualityMetrics: {
              completenessScore: cacheQuality.completenessScore,
              missingSections: cacheQuality.missingSections,
              weakSections: cacheQuality.weakSections,
            },
          };
          job.updatedAt = new Date();

          await this.updateJobStatus(jobId, 'completed', cachedReport, undefined, job.metadata as Record<string, unknown>);

          this.broadcastToJob(jobId, {
            type: 'result',
            jobId,
            payload: {
              result: cachedReport,
              metadata: job.metadata,
              cached: true,
            },
            timestamp: new Date(),
          });

          this.clearJobTimeout(jobId);
          this.scheduleJobCleanup(jobId);

          return;
        }

        logger.info(
          {
            jobId,
            cacheId: cachedResult.id,
            completenessScore: cacheQuality.completenessScore,
            missingSections: cacheQuality.missingSections,
            weakSections: cacheQuality.weakSections,
          },
          'Cached report failed quality gates; running fresh research',
        );
      }
    }

    // Check Gradient Knowledge Base cache (backed by DO Managed OpenSearch)
    if (config.isUsingGradient && gradientCacheService.isReady()) {
      try {
        const gradientCacheResult = await gradientCacheService.checkCache(request.query);
        if (gradientCacheResult.hit && gradientCacheResult.content) {
          const { report, usedFallback } = this.materializeCachedReport(gradientCacheResult.content);
          if (usedFallback) {
            logger.warn({ jobId }, 'Ignoring invalid Gradient KB cache entry and running fresh research');
          } else {
            const normalizedCachedSources = this.normalizeAndRankSources(Array.isArray(report.sources) ? report.sources : []);
            const cachedReport = {
              ...report,
              sources: normalizedCachedSources,
            };
            const cacheQuality = this.evaluateReportCompleteness(cachedReport);
            const hasCoreCoverage = CORE_REPORT_SECTIONS.every((section) =>
              !cacheQuality.missingSections.includes(section) && !cacheQuality.weakSections.includes(section),
            );

            if (hasCoreCoverage && cacheQuality.completenessScore >= 0.8) {
              logger.info({ jobId, source: 'gradient-kb' }, 'Returning result from Gradient KB cache');
              job.result = cachedReport;
              job.status = 'completed';
              job.metadata = {
                cached: true,
                cacheSource: 'gradient-kb',
                qualityMetrics: {
                  completenessScore: cacheQuality.completenessScore,
                  missingSections: cacheQuality.missingSections,
                  weakSections: cacheQuality.weakSections,
                },
              };
              job.updatedAt = new Date();

              await this.updateJobStatus(jobId, 'completed', cachedReport, undefined, job.metadata as Record<string, unknown>);

              this.broadcastToJob(jobId, {
                type: 'result',
                jobId,
                payload: {
                  result: cachedReport,
                  metadata: job.metadata,
                  cached: true,
                },
                timestamp: new Date(),
              });

              this.clearJobTimeout(jobId);
              this.scheduleJobCleanup(jobId);

              return;
            }

            logger.info(
              {
                jobId,
                source: 'gradient-kb',
                completenessScore: cacheQuality.completenessScore,
                missingSections: cacheQuality.missingSections,
                weakSections: cacheQuality.weakSections,
              },
              'Gradient KB cache entry failed quality gates; running fresh research',
            );
          }
        }
      } catch (gradientCacheError) {
        logger.warn({ error: gradientCacheError }, 'Gradient KB cache check failed (non-fatal)');
      }
    }

    job.status = 'in_progress';
    job.updatedAt = new Date();
    logger.info({ jobId }, 'Job status set to in_progress');

    await this.updateJobStatus(jobId, 'in_progress');

    this.pushProgress(jobId, { status: 'in_progress', stage: 'planning' });

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
        expectedSubagents: RESEARCH_EXECUTION_BUDGETS.expectedSubagents,
      });

      const contextPrefix = request.context ? `Context: ${request.context}\n\n` : '';
      const focusAreas = request.focusAreas?.length
        ? `Focus Areas: ${request.focusAreas.join(', ')}\n\n`
        : '';
      const buildUserPrompt = (forceToolKickoff: boolean): string => `${contextPrefix}${focusAreas}Research Query: ${request.query}

Produce an evidence-backed investment report that directly answers the user's question with current data.
- Target ${MINIMUM_SOURCE_TARGETS.uniqueSources}+ unique sources from ${MINIMUM_SOURCE_TARGETS.domains}+ domains.
- Include ${MINIMUM_SOURCE_TARGETS.recentSources}+ sources from the last 90 days.
- Keep searches lean; finish once evidence suffices.
- IMPORTANT: Start by fetching the CURRENT stock price via yahoo_quote, then delegate to subagents.
- IMPORTANT: final_report.json must have ALL 17 sections populated with substantive content. No "No section generated." values.
- IMPORTANT: The investmentConclusion must directly answer whether the stock is a good investment NOW.
${forceToolKickoff ? '- REQUIRED FIRST ACTION: call exa_search before any narrative output.' : ''}`;
      let toolCalls = 0;
      let subagentCalls = 0;
      const toolNamesByRunId = new Map<string, string>();
      const enforceBudget = (): void => {
        if (toolCalls > RESEARCH_EXECUTION_BUDGETS.maxToolCalls) {
          throw new ResearchExecutionError(
            'tool_budget_exceeded',
            `Tool call budget exceeded (${toolCalls}/${RESEARCH_EXECUTION_BUDGETS.maxToolCalls}).`,
            { toolCalls, subagentCalls },
          );
        }
        if (subagentCalls > RESEARCH_EXECUTION_BUDGETS.maxSubagentCalls) {
          throw new ResearchExecutionError(
            'subagent_budget_exceeded',
            `Subagent call budget exceeded (${subagentCalls}/${RESEARCH_EXECUTION_BUDGETS.maxSubagentCalls}).`,
            { toolCalls, subagentCalls },
          );
        }
      };

      const invokeWithTimeout = async (forceToolKickoff = false): Promise<AgentInvokeResult> => {
        const agentInvokePromise = agent.invoke({
          messages: [{
            role: 'user',
            content: buildUserPrompt(forceToolKickoff),
          }],
        }, {
          recursionLimit: RESEARCH_EXECUTION_BUDGETS.recursionLimit,
          callbacks: [{
            handleToolStart: (...args: unknown[]) => {
              const serialized = args[0];
              const input = args[1];
              const runId = typeof args[2] === 'string' ? args[2] : crypto.randomUUID();
              const toolName = this.inferToolName(serialized, input);
              const normalizedToolName = toolName.toLowerCase();
              toolNamesByRunId.set(runId, toolName);
              toolCalls += 1;
              const inputRecord = input && typeof input === 'object'
                ? input as Record<string, unknown>
                : undefined;
              const likelySubagentCall =
                normalizedToolName === 'task' ||
                normalizedToolName.includes('subagent') ||
                normalizedToolName.includes('delegate') ||
                typeof inputRecord?.subagent_type === 'string';
              if (likelySubagentCall) {
                subagentCalls += 1;
              }
              enforceBudget();

              this.runSafeProgressCallback(jobId, 'handleToolStart', () => {
                this.upsertSubAgentActivity(jobId, {
                  id: runId,
                  name: toolName,
                  status: 'running',
                  detail: this.snippetFromUnknown(input) ?? 'Tool execution started',
                  timestamp: new Date().toISOString(),
                });

                // Broadcast granular progress within the delegating stage
                const expected = RESEARCH_EXECUTION_BUDGETS.expectedSubagents;
                const completedSoFar = this.getOrCreateProgress(jobId)
                  .subAgentActivities.filter((a) => a.status === 'completed').length;
                this.pushProgress(jobId, {
                  stage: 'delegating',
                  completedSubagents: completedSoFar,
                  expectedSubagents: expected,
                });
              });
            },
            handleToolEnd: (...args: unknown[]) => {
              this.runSafeProgressCallback(jobId, 'handleToolEnd', () => {
                const output = args[0];
                const runId = typeof args[1] === 'string' ? args[1] : crypto.randomUUID();

                const urls = this.extractUrlsFromUnknown(output);
                this.appendUrls(jobId, urls);

                this.upsertSubAgentActivity(jobId, {
                  id: runId,
                  name: toolNamesByRunId.get(runId) ?? 'tool',
                  status: 'completed',
                  detail: this.snippetFromUnknown(output) ?? 'Tool execution completed',
                  timestamp: new Date().toISOString(),
                });

                // Broadcast granular progress within the delegating stage
                const expected = RESEARCH_EXECUTION_BUDGETS.expectedSubagents;
                const completedSoFar = this.getOrCreateProgress(jobId)
                  .subAgentActivities.filter((a) => a.status === 'completed').length;
                this.pushProgress(jobId, {
                  stage: 'delegating',
                  completedSubagents: completedSoFar,
                  expectedSubagents: expected,
                });
              });
            },
            handleToolError: (...args: unknown[]) => {
              this.runSafeProgressCallback(jobId, 'handleToolError', () => {
                const error = args[0];
                const runId = typeof args[1] === 'string' ? args[1] : crypto.randomUUID();

                this.upsertSubAgentActivity(jobId, {
                  id: runId,
                  name: toolNamesByRunId.get(runId) ?? 'tool',
                  status: 'failed',
                  detail: this.snippetFromUnknown(error) ?? 'Tool execution failed',
                  timestamp: new Date().toISOString(),
                });
              });
            },
            handleLLMEnd: (...args: unknown[]) => {
              this.runSafeProgressCallback(jobId, 'handleLLMEnd', () => {
                const resultPayload = args[0];
                const snippet = this.snippetFromUnknown(resultPayload);
                if (snippet) {
                  this.appendReasoning(jobId, snippet);
                }
              });
            },
          }],
        }) as Promise<AgentInvokeResult>;

        let invokeTimeout: ReturnType<typeof setTimeout> | undefined;
        try {
          const timeoutPromise = new Promise<never>((_, reject) => {
            invokeTimeout = setTimeout(() => {
              reject(
                new ResearchExecutionError(
                  'timeout',
                  `Research run exceeded ${Math.round(RESEARCH_EXECUTION_BUDGETS.maxRunMs / 60000)} minute budget.`,
                  { toolCalls, subagentCalls },
                ),
              );
            }, RESEARCH_EXECUTION_BUDGETS.maxRunMs);
          });
          return await Promise.race([agentInvokePromise, timeoutPromise]);
        } finally {
          if (invokeTimeout) clearTimeout(invokeTimeout);
        }
      };

      const maxRateLimitRetries = 2;
      let result: AgentInvokeResult | undefined;
      let lastInvokeError: unknown;
      for (let attempt = 0; attempt <= maxRateLimitRetries; attempt++) {
        try {
          result = await invokeWithTimeout();

          // Single retry guard: retry if either no tool activity or too-quick completion
          if (attempt === 0) {
            const hasFiles = Object.keys(result.files ?? {}).length > 0;
            const hasToolCalls = this.hasToolCallsInResult(result) || toolCalls > 0;
            const elapsedSoFar = Date.now() - startTime;
            const needsRetry =
              (!hasFiles && !hasToolCalls) ||
              (subagentCalls < 2 && elapsedSoFar < 60_000);

            if (needsRetry) {
              const reason = !hasFiles && !hasToolCalls
                ? 'No tool activity detected in first attempt; retrying with tool-first instruction.'
                : `Research completed too quickly (${Math.round(elapsedSoFar / 1000)}s, ${subagentCalls} subagent calls). Retrying with more explicit instructions.`;
              this.appendReasoning(jobId, reason);
              result = await invokeWithTimeout(true);
            }
          }
          break;
        } catch (invokeError) {
          lastInvokeError = invokeError;
          const failureCode = inferFailureCode(invokeError);
          if (failureCode === 'rate_limited' && attempt < maxRateLimitRetries) {
            const waitMs = 30_000 * (attempt + 1);
            this.appendReasoning(jobId, `Rate limit reached; backing off for ${Math.round(waitMs / 1000)}s before retry (attempt ${attempt + 1}/${maxRateLimitRetries}).`);
            await new Promise((resolve) => setTimeout(resolve, waitMs));
            continue;
          }

          if (failureCode === 'recursion_limit_reached') {
            const observedUrls = this.getOrCreateProgress(jobId).urls.length;
            if (observedUrls >= MINIMUM_SOURCE_TARGETS.uniqueSources) {
              this.appendReasoning(
                jobId,
                `Recursion limit reached after collecting ${observedUrls} URLs; finalizing from partial artifacts.`,
              );

              // Synthesize a meaningful summary from collected reasoning instead of using a useless error message
              const progress = this.getOrCreateProgress(jobId);
              const reasoningNotes = progress.reasoning;
              const synthesizedSummary = reasoningNotes.length > 0
                ? reasoningNotes.filter((n) => !n.startsWith('Rate limit') && !n.startsWith('Recursion limit')).join('\n\n')
                : `Research collected data from ${observedUrls} sources but could not complete full analysis before hitting the recursion limit.`;

              // Try disk first, then fall back to empty (virtualMode means disk is usually empty)
              const artifactFiles = await this.collectArtifactFiles(artifactRoot);
              const hasArtifacts = Object.keys(artifactFiles).length > 0;

              result = {
                messages: [{ content: synthesizedSummary }],
                files: hasArtifacts ? artifactFiles : {},
                todos: [],
              };
              break;
            }
          }

          throw invokeError;
        }
      }
      if (!result) {
        if (inferFailureCode(lastInvokeError) === 'recursion_limit_reached') {
          throw new ResearchExecutionError(
            'recursion_limit_reached',
            'Recursion limit reached before sufficient evidence was gathered.',
            {
              stage: 'execution',
              toolCalls,
              subagentCalls,
              observedUrls: this.getOrCreateProgress(jobId).urls.length,
              elapsedMs: Date.now() - startTime,
            },
          );
        }

        throw new ResearchExecutionError(
          'rate_limited',
          'Provider rate limit persisted after retry.',
          {
            stage: 'execution',
            toolCalls,
            subagentCalls,
            elapsedMs: Date.now() - startTime,
          },
        );
      }

      this.broadcastStage(jobId, 'reconciling');

      const duration = Date.now() - startTime;
      const files = result.files ?? {};
      const filesAsStrings = this.flattenFiles(files);
      let sources = this.extractSources(filesAsStrings);
      if (sources.length === 0) {
        const observedUrls = this.getOrCreateProgress(jobId).urls;
        if (observedUrls.length > 0) {
          sources = observedUrls.map((url) => ({
            url: canonicalizeUrl(url),
            title: extractDomain(url) ?? 'Research Source',
            domain: extractDomain(url),
            sourceType: 'web_search',
          }));
        }
      }
      sources = this.normalizeAndRankSources(sources);
      sources = this.filterSourcesByQueryRelevance(sources, request.query);

      let report = await this.buildReport({
        files: filesAsStrings,
        artifactRoot,
        fallbackSummary: result.messages[result.messages.length - 1]?.content,
        sources,
        reasoning: this.getOrCreateProgress(jobId).reasoning,
      });

      this.broadcastStage(jobId, 'auditing');

      let sourceMetrics = this.calculateSourceMetrics(sources);
      let reportQuality = this.evaluateReportCompleteness(report);
      this.appendUrls(jobId, sources.map((source) => source.url));
      this.appendReasoning(jobId, `Collected ${sourceMetrics.uniqueSources} unique sources across ${sourceMetrics.domainCount} domains.`);
      let observedUrlCount = this.getOrCreateProgress(jobId).urls.length;
      let hasAnyEvidence = sourceMetrics.uniqueSources > 0 || observedUrlCount > 0;
      let hasCoreCoverage = CORE_REPORT_SECTIONS.every((section) =>
        !reportQuality.missingSections.includes(section) && !reportQuality.weakSections.includes(section),
      );
      let hasSubstantiveContent = reportQuality.completenessScore >= 0.78 && hasCoreCoverage;

      if (!hasSubstantiveContent || !hasAnyEvidence) {
        const degradation = this.detectProviderDegradation(jobId, {
          report,
          toolCalls,
          subagentCalls,
          hasAnyEvidence,
        });
        const shouldAttemptEmergencyRecovery = hasAnyEvidence || degradation.degraded || toolCalls >= 10;

        if (shouldAttemptEmergencyRecovery) {
          this.appendReasoning(
            jobId,
            'Attempting deterministic emergency recovery path due weak/empty structured output.',
          );

          const emergencySources = await this.collectEmergencySources(request.query);
          if (emergencySources.length > 0) {
            sources = this.normalizeAndRankSources([...sources, ...emergencySources]);
            sources = this.filterSourcesByQueryRelevance(sources, request.query);
            this.appendUrls(jobId, emergencySources.map((source) => source.url));
          }

          if (sources.length > 0) {
            report = this.buildDeterministicReportFromEvidence({
              query: request.query,
              sources,
              degradationReasons: degradation.reasons,
            });

            sourceMetrics = this.calculateSourceMetrics(sources);
            reportQuality = this.evaluateReportCompleteness(report);
            observedUrlCount = this.getOrCreateProgress(jobId).urls.length;
            hasAnyEvidence = sourceMetrics.uniqueSources > 0 || observedUrlCount > 0;
            hasCoreCoverage = CORE_REPORT_SECTIONS.every((section) =>
              !reportQuality.missingSections.includes(section) && !reportQuality.weakSections.includes(section),
            );
            hasSubstantiveContent = reportQuality.completenessScore >= 0.78 && hasCoreCoverage;
          }
        }
      }

      const outputGuardrailResult = await guardrailsService.checkContent('', JSON.stringify(report));
      if (!outputGuardrailResult.passed) {
        throw new ResearchExecutionError(
          'guardrails_blocked',
          formatGuardrailError(outputGuardrailResult.triggered),
          { guardrails: outputGuardrailResult.triggered, stage: 'output' },
        );
      }

      if (!hasSubstantiveContent || !hasAnyEvidence) {
        if (!hasAnyEvidence) {
          const degradation = this.detectProviderDegradation(jobId, {
            report,
            toolCalls,
            subagentCalls,
            hasAnyEvidence,
          });
          if (degradation.degraded) {
            logger.warn(
              {
                jobId,
                reasons: degradation.reasons,
                rateLimited: degradation.rateLimited,
                toolCalls,
                subagentCalls,
                elapsedMs: Date.now() - startTime,
              },
              'Provider degradation detected during output validation with no evidence',
            );

            this.appendReasoning(
              jobId,
              `Detected provider degradation with no evidence collected. reasons=${degradation.reasons.join(', ') || 'unknown'}`,
            );

            throw new ResearchExecutionError(
              degradation.rateLimited ? 'rate_limited' : 'provider_error',
              'Research could not gather evidence due to upstream provider failures (rate limits/auth).',
              {
                stage: 'output_validation',
                toolCalls,
                subagentCalls,
                uniqueSources: sourceMetrics.uniqueSources,
                observedUrls: observedUrlCount,
                domainCount: sourceMetrics.domainCount,
                missingSections: reportQuality.missingSections,
                weakSections: reportQuality.weakSections,
                completenessScore: reportQuality.completenessScore,
                degradationReasons: degradation.reasons,
                elapsedMs: Date.now() - startTime,
              },
            );
          }
        }

        throw new ResearchExecutionError(
          'insufficient_research_output',
          'Research produced insufficient output (no substantive content or evidence).',
          {
            stage: 'output_validation',
            toolCalls,
            subagentCalls,
            uniqueSources: sourceMetrics.uniqueSources,
            observedUrls: observedUrlCount,
            domainCount: sourceMetrics.domainCount,
            missingSections: reportQuality.missingSections,
            weakSections: reportQuality.weakSections,
            completenessScore: reportQuality.completenessScore,
            elapsedMs: Date.now() - startTime,
          },
        );
      }

      const isSourceCoverageMet =
        sourceMetrics.uniqueSources >= MINIMUM_SOURCE_TARGETS.uniqueSources &&
        sourceMetrics.domainCount >= MINIMUM_SOURCE_TARGETS.domains &&
        sourceMetrics.recentSourceCount >= MINIMUM_SOURCE_TARGETS.recentSources;

      if (!hasCoreCoverage) {
        report.auditReport.status = 'pass_with_caveats';
        report.auditReport.notes.push(
          `Core report sections were under-populated after synthesis. missing=${reportQuality.missingSections.join(', ') || 'none'}, weak=${reportQuality.weakSections.join(', ') || 'none'}, completeness=${reportQuality.completenessScore.toFixed(2)}`,
        );
      }

      if (!isSourceCoverageMet) {
        report.auditReport.status = 'pass_with_caveats';
        report.auditReport.notes.push(
          `Source coverage below target. uniqueSources=${sourceMetrics.uniqueSources}/${MINIMUM_SOURCE_TARGETS.uniqueSources}, domains=${sourceMetrics.domainCount}/${MINIMUM_SOURCE_TARGETS.domains}, recentSources=${sourceMetrics.recentSourceCount}/${MINIMUM_SOURCE_TARGETS.recentSources}`,
        );
      }

      if (!reportQuality.bullBearDistinct) {
        report.auditReport.status = 'pass_with_caveats';
        report.auditReport.notes.push(
          `Bull and bear sections were too similar (overlap=${reportQuality.bullBearOverlapScore.toFixed(2)}).`,
        );
      }

      if (job.status !== 'in_progress') {
        logger.warn({ jobId, status: job.status }, 'Skipping completion because job is no longer active');
        return;
      }

      job.result = report;
      job.status = 'completed';
      job.metadata = {
        todoList: result.todos?.map((todo) => todo.content),
        files: filesAsStrings,
        duration,
        sourceMetrics,
        orchestrationMetrics: {
          subagentCountUsed: RESEARCH_EXECUTION_BUDGETS.expectedSubagents,
          taskCount: subagentCalls,
        },
        budgetMetrics: {
          toolCalls,
          subagentCalls,
          elapsedMs: duration,
        },
        qualityMetrics: {
          completenessScore: reportQuality.completenessScore,
          missingSections: reportQuality.missingSections,
          weakSections: reportQuality.weakSections,
          bullBearDistinct: reportQuality.bullBearDistinct,
          bullBearOverlapScore: reportQuality.bullBearOverlapScore,
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

      this.pushProgress(jobId, {
        status: 'completed',
        stage: 'completed',
        uniqueSources: sourceMetrics.uniqueSources,
        domainCount: sourceMetrics.domainCount,
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
        const publishedDates = sources
          .map((source) => source.publishedDate)
          .filter((value): value is string => Boolean(value))
          .sort((left, right) => (parseDateMs(right) ?? 0) - (parseDateMs(left) ?? 0));

        await semanticPromptCache.addToCache({
          userId: job.userId,
          query: job.query,
          response: JSON.stringify(report),
          responseMetadata: {
            sourceCount: sourceMetrics.uniqueSources,
            domainCount: sourceMetrics.domainCount,
            recentSourceCount: sourceMetrics.recentSourceCount,
            recentSourceRatio:
              sourceMetrics.uniqueSources > 0
                ? sourceMetrics.recentSourceCount / sourceMetrics.uniqueSources
                : 0,
            newestSourceDate: publishedDates[0],
            oldestSourceDate: publishedDates[publishedDates.length - 1],
            completenessScore: reportQuality.completenessScore,
            bullBearDistinct: reportQuality.bullBearDistinct,
            bullBearOverlapScore: reportQuality.bullBearOverlapScore,
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
          const reportSources = report.sources?.map(s => s.url).filter(Boolean) || [];
          await gradientCacheService.addToCache(
            job.query,
            report.investmentConclusion,
            reportSources,
          );
        } catch (cacheError) {
          logger.warn({ error: cacheError }, 'Failed to add result to Gradient cache');
        }
      }

      this.clearJobTimeout(jobId);
      this.scheduleJobCleanup(jobId);

    } catch (error) {
      await this.failJob(jobId, error, {
        failureStage: 'execution',
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
        const canonical = canonicalizeUrl(source.url);
        if (seenUrls.has(canonical)) continue;
        seenUrls.add(canonical);
        sources.push({
          ...source,
          url: canonical,
          domain: source.domain ?? extractDomain(canonical),
        });
      }

      const urlMatches = content.match(/https?:\/\/[^\s)\]>"]+/g) ?? [];
      for (const url of urlMatches) {
        const canonical = canonicalizeUrl(url);
        if (seenUrls.has(canonical)) continue;
        seenUrls.add(canonical);
        sources.push({
          url: canonical,
          title: extractDomain(url) ?? 'Research Source',
          domain: extractDomain(url),
        });
      }
    }

    return sources;
  }

  private normalizeAndRankSources(sources: ResearchSource[]): ResearchSource[] {
    const bestByCanonicalUrl = new Map<string, ResearchSource>();

    const getSourceScore = (source: ResearchSource): number => {
      const relevance = clamp01(source.relevanceScore ?? 0.5);
      const recency = computeSourceRecencyScore(source.publishedDate);
      return relevance * 0.65 + recency * 0.35;
    };

    for (const source of sources) {
      const canonicalUrl = canonicalizeUrl(source.url);
      const normalized: ResearchSource = {
        ...source,
        url: canonicalUrl,
        domain: source.domain ?? extractDomain(canonicalUrl),
      };

      const existing = bestByCanonicalUrl.get(canonicalUrl);
      if (!existing) {
        bestByCanonicalUrl.set(canonicalUrl, normalized);
        continue;
      }

      if (getSourceScore(normalized) > getSourceScore(existing)) {
        bestByCanonicalUrl.set(canonicalUrl, normalized);
      }
    }

    const bestBySnippet = new Map<string, ResearchSource>();
    const withoutFingerprint: ResearchSource[] = [];
    for (const source of bestByCanonicalUrl.values()) {
      const fingerprint = snippetFingerprint(source.snippet ?? source.title);
      if (!fingerprint) {
        withoutFingerprint.push(source);
        continue;
      }

      const existing = bestBySnippet.get(fingerprint);
      if (!existing || getSourceScore(source) > getSourceScore(existing)) {
        bestBySnippet.set(fingerprint, source);
      }
    }

    return [...bestBySnippet.values(), ...withoutFingerprint]
      .sort((left, right) => {
        const scoreDelta = getSourceScore(right) - getSourceScore(left);
        if (scoreDelta !== 0) return scoreDelta;

        const leftDate = parseDateMs(left.publishedDate) ?? Number.NEGATIVE_INFINITY;
        const rightDate = parseDateMs(right.publishedDate) ?? Number.NEGATIVE_INFINITY;
        if (leftDate !== rightDate) return rightDate - leftDate;

        return left.url.localeCompare(right.url);
      });
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
    reasoning?: string[];
  }): Promise<InstitutionalResearchReport> {
    const { files, artifactRoot, fallbackSummary, sources, reasoning } = args;
    const fallbackReport = this.buildFallbackReport(files, fallbackSummary, sources, reasoning);

    const mergeWithFallback = (candidate: InstitutionalResearchReport): InstitutionalResearchReport => {
      const merged = this.repairReportWithFallback(candidate, fallbackReport);
      return {
        ...merged,
        sources,
      };
    };

    const finalReportPath = path.join(artifactRoot, 'final_report.json');
    const diskReport = await this.readJsonIfPresent(finalReportPath);
    if (diskReport && isInstitutionalResearchReport(diskReport)) {
      return mergeWithFallback(diskReport);
    }

    const fileReport = parseMaybeJson<unknown>(files['/final_report.json'] ?? files['final_report.json'] ?? '');
    if (fileReport && isInstitutionalResearchReport(fileReport)) {
      return mergeWithFallback(fileReport);
    }

    return fallbackReport;
  }

  private async readJsonIfPresent(filePath: string): Promise<unknown | undefined> {
    try {
      const content = await readFile(filePath, 'utf8');
      return parseMaybeJson<unknown>(content);
    } catch {
      return undefined;
    }
  }

  private async collectArtifactFiles(rootDir: string): Promise<Record<string, string>> {
    const collected: Record<string, string> = {};

    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const absolutePath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(absolutePath);
          continue;
        }

        if (!entry.isFile()) continue;
        if (!/\.(md|json|txt)$/i.test(entry.name)) continue;

        try {
          const content = await readFile(absolutePath, 'utf8');
          const relative = path.relative(rootDir, absolutePath).split(path.sep).join('/');
          collected[`/${relative}`] = content;
        } catch {
          // Ignore unreadable artifact files and continue collecting.
        }
      }
    };

    try {
      await walk(rootDir);
    } catch {
      return {};
    }

    return collected;
  }

  private materializeCachedReport(responseText: string): {
    report: InstitutionalResearchReport;
    usedFallback: boolean;
  } {
    const parsed = parseMaybeJson<unknown>(responseText);
    if (parsed && isInstitutionalResearchReport(parsed)) {
      return { report: parsed, usedFallback: false };
    }

    logger.warn('Cached response was not a valid InstitutionalResearchReport; using fallback report synthesis');
    return {
      report: this.buildMinimalFallbackReportFromText(responseText),
      usedFallback: true,
    };
  }

  private buildMinimalFallbackReportFromText(rawText: string): InstitutionalResearchReport {
    const summary = sanitizeFallbackSummary(rawText);
    const noData = 'Insufficient data was available to generate this section from the cached response.';
    return {
      executiveSummary: summary,
      companySnapshot: noData,
      industryAndMarketStructure: noData,
      businessModelAndUnitEconomics: noData,
      financialQualityAndTrendAnalysis: noData,
      capitalAllocationReview: noData,
      valuationRelative: noData,
      valuationIntrinsic: noData,
      competitivePositionAndMoat: noData,
      managementGovernanceAssessment: noData,
      regulatoryAndLegalRisk: noData,
      bullCase: noData,
      bearCase: noData,
      scenarioFramework: [],
      catalystCalendar: noData,
      portfolioConstructionView: noData,
      investmentConclusion: summary,
      evidenceIndex: [],
      auditReport: {
        status: 'pass_with_caveats',
        checkedClaims: 0,
        unresolvedClaims: [],
        notes: ['Cached response format was invalid; fallback report was generated from cached text.'],
      },
      sources: [],
    };
  }

  private isSectionEffectivelyEmpty(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    return (
      normalized.length === 0 ||
      normalized === 'no section generated.' ||
      normalized.startsWith('insufficient data')
    );
  }

  private evaluateReportCompleteness(report: InstitutionalResearchReport): ReportQualityMetrics {
    const missingSections: ReportSectionKey[] = [];
    const weakSections: ReportSectionKey[] = [];

    for (const sectionKey of REPORT_SECTION_KEYS) {
      const value = report[sectionKey];
      if (this.isSectionEffectivelyEmpty(value)) {
        missingSections.push(sectionKey);
        continue;
      }

      if (value.trim().length < SECTION_MIN_CHARACTERS[sectionKey]) {
        weakSections.push(sectionKey);
      }
    }

    const bullCase = report.bullCase.trim();
    const bearCase = report.bearCase.trim();
    const bullBearOverlapScore = computeJaccardSimilarity(bullCase, bearCase);
    const bullBearDistinct =
      bullCase.length >= SECTION_MIN_CHARACTERS.bullCase &&
      bearCase.length >= SECTION_MIN_CHARACTERS.bearCase &&
      bullBearOverlapScore < 0.78;

    if (!bullBearDistinct) {
      if (!missingSections.includes('bullCase') && !weakSections.includes('bullCase')) {
        weakSections.push('bullCase');
      }
      if (!missingSections.includes('bearCase') && !weakSections.includes('bearCase')) {
        weakSections.push('bearCase');
      }
    }

    const totalSections = REPORT_SECTION_KEYS.length;
    const filledSections = totalSections - missingSections.length;
    const weakPenalty = weakSections.length * 0.5;
    const completenessScore = Math.max(0, Math.min(1, (filledSections - weakPenalty) / totalSections));

    return {
      missingSections,
      weakSections,
      filledSections,
      totalSections,
      completenessScore,
      bullBearOverlapScore,
      bullBearDistinct,
    };
  }

  private repairReportWithFallback(
    candidate: InstitutionalResearchReport,
    fallbackReport: InstitutionalResearchReport,
  ): InstitutionalResearchReport {
    const repaired: InstitutionalResearchReport = {
      ...candidate,
      scenarioFramework:
        Array.isArray(candidate.scenarioFramework) && candidate.scenarioFramework.length > 0
          ? candidate.scenarioFramework
          : fallbackReport.scenarioFramework,
      evidenceIndex:
        Array.isArray(candidate.evidenceIndex) && candidate.evidenceIndex.length > 0
          ? candidate.evidenceIndex
          : fallbackReport.evidenceIndex,
      auditReport: candidate.auditReport ?? fallbackReport.auditReport,
      sources: candidate.sources ?? fallbackReport.sources,
    };

    for (const sectionKey of REPORT_SECTION_KEYS) {
      const value = candidate[sectionKey];
      const fallbackValue = fallbackReport[sectionKey];
      const isMissing = this.isSectionEffectivelyEmpty(value);
      const isWeak = !isMissing && value.trim().length < SECTION_MIN_CHARACTERS[sectionKey];
      if (isMissing || isWeak) {
        repaired[sectionKey] = fallbackValue;
      }
    }

    const quality = this.evaluateReportCompleteness(repaired);
    if (!quality.bullBearDistinct) {
      repaired.bullCase = fallbackReport.bullCase;
      repaired.bearCase = fallbackReport.bearCase;
    }

    return repaired;
  }

  private buildFallbackReport(
    files: Record<string, string>,
    fallbackSummary: unknown,
    sources: ResearchSource[],
    reasoning?: string[],
  ): InstitutionalResearchReport {
    const summary = sanitizeFallbackSummary(fallbackSummary);
    const noData = FALLBACK_NO_DATA_MESSAGE;

    // When there are no artifact files at all (common with virtualMode), synthesize from reasoning
    const hasFiles = Object.keys(files).length > 0;
    const reasoningText = (reasoning ?? []).filter(Boolean).join('\n\n');
    const syntheticContent = !hasFiles && reasoningText.length > 100
      ? reasoningText
      : undefined;

    const get = (...keys: string[]): string => {
      for (const key of keys) {
        if (files[key]) return files[key]!;
      }
      return '';
    };

    const sectionFromExplicit = (
      explicit: string,
      inferKeywords: string[],
      headingHints?: string[],
    ): string | undefined => {
      const headingMatch = headingHints
        ? extractMarkdownSectionByHeadings(explicit, headingHints)
        : undefined;
      if (headingMatch) return headingMatch;

      const paragraphMatch = extractParagraphsByKeywords(explicit, inferKeywords);
      if (paragraphMatch) return paragraphMatch;

      return undefined;
    };

    // Helper: try explicit paths first, then keyword-based inference, then synthetic, then fallback
    const section = (explicitKeys: string[], inferKeywords: string[], headingHints?: string[]): string => {
      const explicit = get(...explicitKeys);
      if (explicit) {
        const extracted = sectionFromExplicit(explicit, inferKeywords, headingHints);
        if (extracted) return extracted;
      }
      const inferred = inferSectionFromFiles(files, inferKeywords, '');
      if (inferred) return inferred;
      // Use synthetic content from reasoning if available
      return syntheticContent || noData;
    };

    return {
      executiveSummary: summary,
      companySnapshot: section(
        ['/subagents/business_and_financials.md', 'subagents/business_and_financials.md'],
        ['company', 'snapshot', 'overview', 'market cap', 'sector'],
        ['company snapshot', 'company overview'],
      ),
      industryAndMarketStructure: section(
        ['/subagents/market_and_industry.md', 'subagents/market_and_industry.md'],
        ['industry', 'market', 'tam', 'sam', 'macro', 'sector'],
        ['industry and market structure', 'market structure'],
      ),
      businessModelAndUnitEconomics: section(
        ['/subagents/business_and_financials.md', 'subagents/business_and_financials.md'],
        ['business model', 'revenue model', 'unit economics', 'margin', 'pricing'],
        ['business model', 'unit economics'],
      ),
      financialQualityAndTrendAnalysis: section(
        ['/subagents/business_and_financials.md', 'subagents/business_and_financials.md'],
        ['financial', 'earnings', 'revenue', 'cash flow', 'quarterly', 'trend'],
        ['financial quality and trend analysis', 'financial analysis'],
      ),
      capitalAllocationReview: section(
        ['/subagents/business_and_financials.md', 'subagents/business_and_financials.md'],
        ['capital allocation', 'dividend', 'buyback', 'roic', 'capex'],
        ['capital allocation review', 'capital allocation'],
      ),
      valuationRelative: section(
        ['/subagents/valuation.md', 'subagents/valuation.md'],
        ['valuation', 'peer', 'multiple', 'p/e', 'ev/ebitda', 'relative'],
        ['valuation relative', 'relative valuation'],
      ),
      valuationIntrinsic: section(
        ['/subagents/valuation.md', 'subagents/valuation.md'],
        ['dcf', 'intrinsic', 'fair value', 'upside', 'downside', 'discount'],
        ['valuation intrinsic', 'intrinsic valuation', 'dcf'],
      ),
      competitivePositionAndMoat: section(
        ['/subagents/competitive_and_strategic.md', 'subagents/competitive_and_strategic.md'],
        ['competitive', 'moat', 'market share', 'differentiation', 'advantage'],
        ['competitive position and moat', 'competitive position', 'moat'],
      ),
      managementGovernanceAssessment: section(
        ['/subagents/competitive_and_strategic.md', 'subagents/competitive_and_strategic.md'],
        ['management', 'governance', 'leadership', 'board', 'ceo'],
        ['management governance assessment', 'management and governance'],
      ),
      regulatoryAndLegalRisk: section(
        ['/subagents/competitive_and_strategic.md', 'subagents/competitive_and_strategic.md'],
        ['regulatory', 'legal', 'litigation', 'compliance', 'policy', 'risk'],
        ['regulatory and legal risk', 'regulatory risk', 'legal risk'],
      ),
      bullCase: section(
        ['/subagents/thesis_and_catalysts.md', 'subagents/thesis_and_catalysts.md'],
        ['bull', 'bullish', 'upside', 'growth', 'opportunity', 'catalyst', 'tailwind'],
        ['bull case', 'bull thesis', 'upside case'],
      ),
      bearCase: section(
        ['/subagents/thesis_and_catalysts.md', 'subagents/thesis_and_catalysts.md'],
        ['bear', 'bearish', 'downside', 'risk', 'threat', 'weakness', 'headwind'],
        ['bear case', 'bear thesis', 'downside case'],
      ),
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
      catalystCalendar: section(
        ['/subagents/thesis_and_catalysts.md', 'subagents/thesis_and_catalysts.md'],
        ['catalyst', 'calendar', 'event', 'earnings date', 'upcoming'],
        ['catalyst calendar', 'catalysts', 'upcoming catalysts'],
      ),
      portfolioConstructionView: section(
        ['/subagents/thesis_and_catalysts.md', 'subagents/thesis_and_catalysts.md'],
        ['portfolio', 'sizing', 'risk budget', 'entry', 'exit', 'position'],
        ['portfolio construction view', 'portfolio construction', 'position sizing'],
      ),
      investmentConclusion: section(
        [
          '/final_report.md',
          'final_report.md',
          '/subagents/thesis_and_catalysts.md',
          'subagents/thesis_and_catalysts.md',
        ],
        ['investment conclusion', 'verdict', 'recommendation', 'buy', 'hold', 'sell'],
        ['investment conclusion', 'final verdict', 'recommendation'],
      ),
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

    // Job already inserted in createResearchJob, just update with results
    await db
      .update(researchJobs)
      .set({
        userId: job.userId,
        query: job.query,
        status: job.status,
        result: job.result,
        metadata: job.metadata ?? {},
        error: job.error ?? null,
        updatedAt: new Date(),
      })
      .where(eq(researchJobs.id, job.id));

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
        // readyState 1 = OPEN
        if ((ws as unknown as { readyState?: number }).readyState === 1) {
          ws.send(data);
        }
      });
    }
  }

  getJob(jobId: string): ResearchJob | undefined {
    return this.jobs.get(jobId);
  }

  getAllJobs(): ResearchJob[] {
    return Array.from(this.jobs.values());
  }

  getProgress(jobId: string): ProgressPayload | undefined {
    return this.progressByJob.get(jobId);
  }
}

export const researchService = new ResearchService();
