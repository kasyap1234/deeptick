import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ExaSearchResults, ExaFindSimilarResults } from '@langchain/exa';
import Exa from 'exa-js';
import { config } from '../config/index.js';

type ExaTool = {
  name: string;
  description: string;
  invoke: (input: unknown, config?: unknown) => Promise<unknown>;
};

const EXA_TOOL_TIMEOUT_MS = 30_000;

const TRACKING_PARAM_NAMES = new Set(['gclid', 'fbclid', 'mc_cid', 'mc_eid']);

export interface NormalizedExaResult {
  url: string;
  title: string;
  snippet?: string;
  highlights?: string[];
  summary?: string;
  publishedDate?: string;
  score?: number;
}

const exaApiKey = config.exaApiKey;
const exaClient = exaApiKey ? new Exa(exaApiKey) : null;

function exaNotConfiguredPayload(query: string, maxResults: number) {
  return JSON.stringify({
    provider: 'exa',
    query,
    maxResults,
    totalResults: 0,
    results: [],
    dedupedCount: 0,
    duplicatesRemoved: 0,
    recentCount: 0,
    newestPublishedDate: null,
    oldestPublishedDate: null,
    error: 'Exa search is not configured. Set EXASEARCH_API_KEY (or EXA_API_KEY).',
    code: 'FEATURE_NOT_CONFIGURED',
    retryable: false,
  });
}

function exaErrorPayload(query: string, maxResults: number, error: unknown, code = 'UPSTREAM_ERROR', retryable = true) {
  return JSON.stringify({
    provider: 'exa',
    query,
    maxResults,
    totalResults: 0,
    results: [],
    dedupedCount: 0,
    duplicatesRemoved: 0,
    recentCount: 0,
    newestPublishedDate: null,
    oldestPublishedDate: null,
    error: error instanceof Error ? error.message : 'Exa tool invocation failed',
    code,
    retryable,
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function normalizeResults(raw: unknown): NormalizedExaResult[] {
  if (!raw) return [];

  const candidate =
    typeof raw === 'string'
      ? (() => {
        try {
          return JSON.parse(raw);
        } catch {
          return [];
        }
      })()
      : raw;

  const items = Array.isArray(candidate)
    ? candidate
    : typeof candidate === 'object' && candidate && 'results' in candidate
      ? (candidate as { results?: unknown[] }).results ?? []
      : [];

  const results: NormalizedExaResult[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const url = typeof record.url === 'string' ? record.url : '';
    const title = typeof record.title === 'string' ? record.title : 'Untitled Source';
    const snippet =
      typeof record.snippet === 'string'
        ? record.snippet
        : typeof record.text === 'string'
          ? record.text.slice(0, 400)
          : undefined;
    const highlights = Array.isArray(record.highlights)
      ? record.highlights.filter((value): value is string => typeof value === 'string')
      : undefined;
    const summary = typeof record.summary === 'string' ? record.summary : undefined;
    const publishedDate = typeof record.publishedDate === 'string' ? record.publishedDate : undefined;
    const score = typeof record.score === 'number' ? record.score : undefined;

    if (!url) continue;

    results.push({
      url,
      title,
      snippet,
      highlights,
      summary,
      publishedDate,
      score,
    });
  }

  return results;
}

function clampScore(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();

    const filteredParams = new URLSearchParams();
    for (const [key, value] of parsed.searchParams.entries()) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.startsWith('utm_') || TRACKING_PARAM_NAMES.has(lowerKey)) continue;
      filteredParams.append(key, value);
    }
    filteredParams.sort();

    parsed.search = filteredParams.toString();
    if (parsed.pathname === '/') {
      parsed.pathname = '';
    }

    return parsed.toString();
  } catch {
    return url.trim();
  }
}

export function snippetFingerprint(text?: string): string | undefined {
  if (!text) return undefined;

  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return undefined;
  return normalized.slice(0, 220);
}

export function computeRecencyScore(publishedDate?: string): number {
  if (!publishedDate) return 0.2;

  const publishedAt = new Date(publishedDate);
  const publishedMs = publishedAt.getTime();
  if (Number.isNaN(publishedMs)) return 0.2;

  const ageDays = (Date.now() - publishedMs) / (1000 * 60 * 60 * 24);
  if (ageDays <= 7) return 1.0;
  if (ageDays <= 30) return 0.85;
  if (ageDays <= 90) return 0.7;
  if (ageDays <= 180) return 0.45;
  return 0.2;
}

function computeCombinedScore(result: NormalizedExaResult): number {
  const relevance = clampScore(result.score ?? 0.5);
  const recency = computeRecencyScore(result.publishedDate);
  return relevance * 0.65 + recency * 0.35;
}

function parsePublishedDateMs(publishedDate?: string): number {
  if (!publishedDate) return Number.NEGATIVE_INFINITY;
  const publishedMs = new Date(publishedDate).getTime();
  return Number.isNaN(publishedMs) ? Number.NEGATIVE_INFINITY : publishedMs;
}

function compareResults(a: NormalizedExaResult, b: NormalizedExaResult): number {
  const scoreDiff = computeCombinedScore(b) - computeCombinedScore(a);
  if (scoreDiff !== 0) return scoreDiff;

  const aPublished = parsePublishedDateMs(a.publishedDate);
  const bPublished = parsePublishedDateMs(b.publishedDate);
  if (aPublished !== bPublished) return bPublished - aPublished;

  return a.url.localeCompare(b.url);
}

function chooseBetterResult(existing: NormalizedExaResult, candidate: NormalizedExaResult): NormalizedExaResult {
  return compareResults(existing, candidate) <= 0 ? existing : candidate;
}

export function dedupeAndRankResults(results: NormalizedExaResult[]): NormalizedExaResult[] {
  const bestByCanonicalUrl = new Map<string, NormalizedExaResult>();

  for (const result of results) {
    const canonicalUrl = canonicalizeUrl(result.url);
    const existing = bestByCanonicalUrl.get(canonicalUrl);
    if (!existing) {
      bestByCanonicalUrl.set(canonicalUrl, result);
      continue;
    }

    bestByCanonicalUrl.set(canonicalUrl, chooseBetterResult(existing, result));
  }

  const bestBySnippet = new Map<string, NormalizedExaResult>();
  const withoutSnippetFingerprint: NormalizedExaResult[] = [];

  for (const result of bestByCanonicalUrl.values()) {
    const fingerprint = snippetFingerprint(result.snippet);
    if (!fingerprint) {
      withoutSnippetFingerprint.push(result);
      continue;
    }

    const existing = bestBySnippet.get(fingerprint);
    if (!existing) {
      bestBySnippet.set(fingerprint, result);
      continue;
    }

    bestBySnippet.set(fingerprint, chooseBetterResult(existing, result));
  }

  return [...bestBySnippet.values(), ...withoutSnippetFingerprint].sort(compareResults);
}

function buildRankingMetadata(originalResults: NormalizedExaResult[], dedupedResults: NormalizedExaResult[]) {
  const now = Date.now();
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  let recentCount = 0;
  let newestPublishedDate: { date: string; time: number } | null = null;
  let oldestPublishedDate: { date: string; time: number } | null = null;

  for (const result of dedupedResults) {
    if (!result.publishedDate) continue;
    const publishedAt = new Date(result.publishedDate);
    const publishedMs = publishedAt.getTime();
    if (Number.isNaN(publishedMs)) continue;

    if (now - publishedMs <= ninetyDaysMs) {
      recentCount += 1;
    }

    if (!newestPublishedDate || publishedMs > newestPublishedDate.time) {
      newestPublishedDate = { date: result.publishedDate, time: publishedMs };
    }
    if (!oldestPublishedDate || publishedMs < oldestPublishedDate.time) {
      oldestPublishedDate = { date: result.publishedDate, time: publishedMs };
    }
  }

  return {
    dedupedCount: dedupedResults.length,
    duplicatesRemoved: Math.max(0, originalResults.length - dedupedResults.length),
    recentCount,
    newestPublishedDate: newestPublishedDate?.date ?? null,
    oldestPublishedDate: oldestPublishedDate?.date ?? null,
  };
}

export const exaSearchTool: ExaTool = tool(
  async ({ query, maxResults = 5 }: { query: string; maxResults?: number }) => {
    if (!exaClient) {
      return exaNotConfiguredPayload(query, maxResults);
    }
    try {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      const searchTool = new ExaSearchResults({
        client: exaClient,
        searchArgs: {
          numResults: maxResults,
          startPublishedDate: ninetyDaysAgo,
          highlights: {
            numSentences: 2,
            highlightsPerUrl: 2,
          },
          summary: {
            query,
          },
        },
      });

      const raw = await withTimeout(searchTool.invoke(query), EXA_TOOL_TIMEOUT_MS, 'Exa search');
      const normalized = normalizeResults(raw);
      const ranked = dedupeAndRankResults(normalized);
      const rankingMetadata = buildRankingMetadata(normalized, ranked);

      return JSON.stringify({
        provider: 'exa',
        query,
        maxResults,
        totalResults: ranked.length,
        results: ranked,
        ...rankingMetadata,
      });
    } catch (error) {
      const code = error instanceof Error && error.message.includes('timed out')
        ? 'TIMEOUT'
        : 'UPSTREAM_ERROR';
      return exaErrorPayload(query, maxResults, error, code, code !== 'FEATURE_NOT_CONFIGURED');
    }
  },
  {
    name: 'exa_search',
    description:
      'Search the web using Exa via LangChain integration. Use this for all external web research. Returns normalized results with URL, title, snippet, and optional published date.',
    schema: z.object({
      query: z.string().describe('The search query to execute'),
      maxResults: z.number().int().min(1).max(10).optional().default(5).describe('Maximum number of results to return'),
    }),
  }
);

export const exaFindSimilarTool: ExaTool = tool(
  async ({ url, maxResults = 5 }: { url: string; maxResults?: number }) => {
    if (!exaClient) {
      return JSON.stringify({
        provider: 'exa',
        seedUrl: url,
        maxResults,
        totalResults: 0,
        results: [],
        dedupedCount: 0,
        duplicatesRemoved: 0,
        recentCount: 0,
        newestPublishedDate: null,
        oldestPublishedDate: null,
        error: 'Exa search is not configured. Set EXASEARCH_API_KEY (or EXA_API_KEY).',
        code: 'FEATURE_NOT_CONFIGURED',
        retryable: false,
      });
    }
    try {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      const similarTool = new ExaFindSimilarResults({
        client: exaClient,
        searchArgs: {
          numResults: maxResults,
          startPublishedDate: ninetyDaysAgo,
          highlights: {
            numSentences: 2,
            highlightsPerUrl: 2,
          },
          summary: {
            query: url,
          },
        },
      });

      const raw = await withTimeout(similarTool.invoke(url), EXA_TOOL_TIMEOUT_MS, 'Exa find similar');
      const normalized = normalizeResults(raw);
      const ranked = dedupeAndRankResults(normalized);
      const rankingMetadata = buildRankingMetadata(normalized, ranked);

      return JSON.stringify({
        provider: 'exa',
        seedUrl: url,
        maxResults,
        totalResults: ranked.length,
        results: ranked,
        ...rankingMetadata,
      });
    } catch (error) {
      return JSON.stringify({
        provider: 'exa',
        seedUrl: url,
        maxResults,
        totalResults: 0,
        results: [],
        dedupedCount: 0,
        duplicatesRemoved: 0,
        recentCount: 0,
        newestPublishedDate: null,
        oldestPublishedDate: null,
        error: error instanceof Error ? error.message : 'Exa find similar failed',
        code: error instanceof Error && error.message.includes('timed out') ? 'TIMEOUT' : 'UPSTREAM_ERROR',
        retryable: true,
      });
    }
  },
  {
    name: 'exa_find_similar',
    description: 'Find similar pages from Exa given a URL. Use to diversify sources and triangulate claims.',
    schema: z.object({
      url: z.string().url().describe('The URL to find similar pages for'),
      maxResults: z.number().int().min(1).max(10).optional().default(5).describe('Maximum number of results to return'),
    }),
  }
);
