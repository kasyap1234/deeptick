import { tool } from 'langchain';
import { z } from 'zod';
import { ExaSearchResults, ExaFindSimilarResults } from '@langchain/exa';
import Exa from 'exa-js';
import { config } from '../config/index.js';

type ExaTool = {
  name: string;
  description: string;
  invoke: (input: unknown, config?: unknown) => Promise<unknown>;
};

const makeTool = tool as any;

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
if (!exaApiKey) {
  throw new Error('Missing EXASEARCH_API_KEY (or legacy EXA_API_KEY) for Exa web search integration.');
}

const exaClient = new Exa(exaApiKey);

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

export const exaSearchTool: ExaTool = makeTool(
  async ({ query, maxResults = 10 }: { query: string; maxResults?: number }) => {
    const searchTool = new ExaSearchResults({
      client: exaClient,
      searchArgs: {
        numResults: maxResults,
        highlights: {
          numSentences: 2,
          highlightsPerUrl: 2,
        },
        summary: {
          query,
        },
      },
    });

    const raw = await searchTool.invoke(query);
    const normalized = normalizeResults(raw);

    return JSON.stringify({
      provider: 'exa',
      query,
      maxResults,
      totalResults: normalized.length,
      results: normalized,
    });
  },
  {
    name: 'exa_search',
    description:
      'Search the web using Exa via LangChain integration. Use this for all external web research. Returns normalized results with URL, title, snippet, and optional published date.',
    schema: z.object({
      query: z.string().describe('The search query to execute'),
      maxResults: z.number().int().min(1).max(25).optional().default(10).describe('Maximum number of results to return'),
    }),
  }
);

export const exaFindSimilarTool: ExaTool = makeTool(
  async ({ url, maxResults = 8 }: { url: string; maxResults?: number }) => {
    const similarTool = new ExaFindSimilarResults({
      client: exaClient,
      searchArgs: {
        numResults: maxResults,
        highlights: {
          numSentences: 2,
          highlightsPerUrl: 2,
        },
        summary: {
          query: url,
        },
      },
    });

    const raw = await similarTool.invoke(url);
    const normalized = normalizeResults(raw);

    return JSON.stringify({
      provider: 'exa',
      seedUrl: url,
      maxResults,
      totalResults: normalized.length,
      results: normalized,
    });
  },
  {
    name: 'exa_find_similar',
    description: 'Find similar pages from Exa given a URL. Use to diversify sources and triangulate claims.',
    schema: z.object({
      url: z.string().url().describe('The URL to find similar pages for'),
      maxResults: z.number().int().min(1).max(20).optional().default(8).describe('Maximum number of results to return'),
    }),
  }
);
