import { tool } from 'langchain';
import { z } from 'zod';
import { logger } from '../utils/logger.js';

const makeTool = tool as any;

export interface Context7DocResult {
  title: string;
  content: string;
  url: string;
  source: string;
}

async function searchContext7Docs(query: string, libraryId?: string): Promise<Context7DocResult[]> {
  try {
    const baseUrl = 'https://api.context7.com/v1';
    
    const response = await fetch(`${baseUrl}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        library_id: libraryId,
        limit: 5,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn({ status: response.status, error: errorText }, 'Context7 search failed');
      return [];
    }

    const data = await response.json() as {
      results?: Array<{
        title?: string;
        content?: string;
        url?: string;
        source?: string;
      }>;
    };

    return (data.results || []).map(item => ({
      title: item.title || 'Untitled',
      content: item.content || '',
      url: item.url || '',
      source: item.source || 'context7',
    }));
  } catch (error) {
    logger.error({ error }, 'Context7 search error');
    return [];
  }
}

async function resolveContext7Library(libraryName: string, query: string): Promise<string | null> {
  try {
    const baseUrl = 'https://api.context7.com/v1';
    
    const response = await fetch(`${baseUrl}/libraries/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        library_name: libraryName,
        query,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as { library_id?: string };
    return data.library_id || null;
  } catch {
    return null;
  }
}

export const context7LookupTool = makeTool(
  async ({ library, query }: { library: string; query: string }) => {
    const libraryId = await resolveContext7Library(library, query);
    
    const results = await searchContext7Docs(query, libraryId || undefined);
    
    if (results.length === 0) {
      return {
        success: false,
        message: `No documentation found for "${library}" with query "${query}"`,
        results: [],
      };
    }

    return {
      success: true,
      message: `Found ${results.length} documentation results for "${library}"`,
      results: results.map(r => ({
        title: r.title,
        content: r.content.slice(0, 1000),
        url: r.url,
        source: r.source,
      })),
    };
  },
  {
    name: 'context7_docs_lookup',
    description: `Search official documentation for libraries, frameworks, and APIs using Context7.
    
This tool is useful when you need to:
- Verify how to use a specific library function or API
- Check official documentation for best practices
- Find correct usage patterns for libraries you're unfamiliar with
- Get authoritative answers about library behavior

Input should be:
- The library/framework name (e.g., "react", "langchain", "next.js")
- The specific question or topic you want to look up

Returns relevant documentation snippets with source URLs.`,
    schema: z.object({
      library: z.string().describe('Library or framework name (e.g., "react", "langchain", "next.js")'),
      query: z.string().describe('The specific question or topic to search in the documentation'),
    }),
  }
);

export const factCheckTool = makeTool(
  async ({ claim, domain }: { claim: string; domain?: string }) => {
    const searchQuery = domain ? `${claim} ${domain}` : claim;
    const results = await searchContext7Docs(searchQuery);
    
    return {
      claim,
      verified: results.length > 0,
      sources: results.map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.content.slice(0, 500),
      })),
    };
  },
  {
    name: 'fact_check',
    description: `Verify factual claims against authoritative sources.

This tool helps validate numerical claims, statistics, or factual statements
by searching the web for corroborating or contradicting evidence.

Input should be:
- The specific claim or fact to verify
- Optional: the context or domain (e.g., "finance", "technology")

Returns sources that support or refute the claim.`,
    schema: z.object({
      claim: z.string().describe('The factual claim or statement to verify'),
      domain: z.string().optional().describe('Optional domain context (e.g., "finance", "technology")'),
    }),
  }
);

export const citationFormatterTool = makeTool(
  async ({ url, title, accessDate }: { url: string; title?: string; accessDate?: string }) => {
    const date = accessDate || new Date().toISOString().split('T')[0];
    
    return {
      formatted: `[${title || 'Source'}](${url}) (accessed ${date})`,
      apa: `${title || url}. (n.d.). Retrieved ${date}, from ${url}`,
      chicago: `${title || url}. Accessed ${date}. ${url}`,
    };
  },
  {
    name: 'format_citation',
    description: `Format a citation for a source URL in a standardized format.

This tool helps format source citations consistently in the report.`,
    schema: z.object({
      url: z.string().describe('The URL of the source'),
      title: z.string().optional().describe('Optional title override'),
      accessDate: z.string().optional().describe('Access date in YYYY-MM-DD format'),
    }),
  }
);

export const tools = [
  context7LookupTool,
  factCheckTool,
  citationFormatterTool,
];

export default tools;
