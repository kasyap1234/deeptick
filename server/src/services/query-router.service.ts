import { db } from '../db/connection.js';
import { researchJobs, type NewResearchJob } from '../db/schema.js';
import { vectorStoreService } from './vector-store.service.js';
import { embeddingService } from './embedding.service.js';
import { gradientCacheService } from './gradient-cache.service.js';
import { config } from '../config/index.js';
import type { InstitutionalResearchReport, ResearchRequest } from '../types/research.types.js';
import { logger } from '../utils/logger.js';

export interface QueryRouterResult {
  shouldSearch: boolean;
  cachedResult?: InstitutionalResearchReport;
  similarQueries: Array<{
    query: string;
    similarity: number;
    jobId: string;
  }>;
  existingJobId?: string;
}

export interface QueryAnalysis {
  intent: 'deep_research' | 'quick_answer' | 'follow_up' | 'comparison';
  entities: string[];
  timeframe?: string;
  requiresFreshData: boolean;
  confidence: number;
}

export class QueryRouterService {
  private similarityThreshold: number;
  private partialMatchThreshold: number;

  constructor(options: { similarityThreshold?: number; partialMatchThreshold?: number } = {}) {
    this.similarityThreshold = options.similarityThreshold ?? 0.9;
    this.partialMatchThreshold = options.partialMatchThreshold ?? 0.8;
  }

  async routeQuery(request: ResearchRequest): Promise<QueryRouterResult> {
    const query = request.query.toLowerCase().trim();

    if (config.isUsingGradient) {
      try {
        await gradientCacheService.initialize();
        const gradientCacheResult = await gradientCacheService.checkCache(query);

        if (gradientCacheResult.hit && gradientCacheResult.content) {
          logger.info(`Gradient KB Cache hit: Query "${query}"`);
          return {
            shouldSearch: false,
            cachedResult: {
              executiveSummary: gradientCacheResult.content,
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
              investmentConclusion: gradientCacheResult.content,
              evidenceIndex: [],
              auditReport: {
                status: 'pass',
                checkedClaims: 0,
                unresolvedClaims: [],
                notes: ['Retrieved from Gradient Knowledge Base cache'],
              },
              sources: [],
            },
            similarQueries: [],
          };
        }
      } catch (error) {
        logger.warn({ error }, 'Gradient cache check failed, falling back to local');
      }
    }

    const queryEmbedding = await embeddingService.embedQuery(query);

    const similarQueries = await vectorStoreService.findSimilarQueries(
      queryEmbedding,
      this.similarityThreshold
    );

    if (similarQueries.length > 0) {
      const bestMatch = similarQueries[0];
      
      if (bestMatch.similarity >= this.similarityThreshold && bestMatch.result) {
        logger.info(`Cache hit: Query "${query}" matched with similarity ${bestMatch.similarity}`);
        return {
          shouldSearch: false,
          cachedResult: bestMatch.result,
          similarQueries: similarQueries.map((sq) => ({
            query: sq.query,
            similarity: sq.similarity,
            jobId: sq.jobId,
          })),
          existingJobId: bestMatch.jobId,
        };
      }

      if (bestMatch.similarity >= this.partialMatchThreshold) {
        logger.info(`Partial cache hit: Query "${query}" matched with similarity ${bestMatch.similarity}`);
        return {
          shouldSearch: true,
          cachedResult: bestMatch.result,
          similarQueries: similarQueries.map((sq) => ({
            query: sq.query,
            similarity: sq.similarity,
            jobId: sq.jobId,
          })),
          existingJobId: bestMatch.jobId,
        };
      }
    }

    return {
      shouldSearch: true,
      similarQueries: similarQueries.map((sq) => ({
        query: sq.query,
        similarity: sq.similarity,
        jobId: sq.jobId,
      })),
    };
  }

  async analyzeQuery(query: string): Promise<QueryAnalysis> {
    const lowerQuery = query.toLowerCase();
    
    // Extract entities (stock tickers, company names)
    const entities = this.extractEntities(query);
    
    // Determine intent
    let intent: QueryAnalysis['intent'] = 'deep_research';
    let requiresFreshData = true;
    let confidence = 0.5;

    // Check for time-sensitive keywords
    const timeSensitiveKeywords = [
      'latest', 'recent', 'today', 'yesterday', 'this week', 'this month',
      'earnings', 'quarterly', 'annual', 'q1', 'q2', 'q3', 'q4', '2024', '2025'
    ];
    
    if (timeSensitiveKeywords.some((kw) => lowerQuery.includes(kw))) {
      requiresFreshData = true;
      confidence += 0.2;
    }

    // Check for follow-up patterns
    const followUpPatterns = [
      'what about', 'how about', 'tell me more', 'explain', 'elaborate',
      'why', 'what do you mean', 'can you clarify'
    ];
    
    if (followUpPatterns.some((pattern) => lowerQuery.includes(pattern))) {
      intent = 'follow_up';
      confidence += 0.3;
    }

    // Check for comparison patterns
    const comparisonPatterns = ['vs', 'versus', 'compare', 'better than', 'difference between'];
    if (comparisonPatterns.some((pattern) => lowerQuery.includes(pattern))) {
      intent = 'comparison';
      confidence += 0.3;
    }

    // Check for quick answer patterns
    const quickAnswerPatterns = ['what is', 'who is', 'when did', 'how many', 'market cap', 'pe ratio'];
    if (quickAnswerPatterns.some((pattern) => lowerQuery.startsWith(pattern))) {
      intent = 'quick_answer';
      confidence += 0.2;
    }

    // Extract timeframe
    const timeframe = this.extractTimeframe(query);

    return {
      intent,
      entities,
      timeframe,
      requiresFreshData,
      confidence: Math.min(confidence, 1.0),
    };
  }

  private extractEntities(query: string): string[] {
    const entities: string[] = [];
    
    // Extract stock tickers (uppercase 1-5 letter words)
    const tickerPattern = /\b[A-Z]{1,5}\b/g;
    const tickers = query.match(tickerPattern) || [];
    entities.push(...tickers);

    // Extract company names (common patterns)
    const companyPatterns = [
      /([A-Z][a-z]+\s+(Inc|Corp|Ltd|LLC|Company|Technologies|Group|Holdings))/g,
      /\b(Apple|Microsoft|Google|Amazon|Tesla|Meta|Nvidia|AMD|Intel|Netflix|Spotify|Uber|Lyft|Airbnb|Zoom|Slack|Salesforce|Adobe|Oracle|IBM|Salesforce)\b/gi,
    ];

    for (const pattern of companyPatterns) {
      const matches = query.match(pattern) || [];
      entities.push(...matches);
    }

    return [...new Set(entities)]; // Remove duplicates
  }

  private extractTimeframe(query: string): string | undefined {
    const timeframePatterns = [
      { pattern: /\b(\d{4})\b/, extract: (m: RegExpMatchArray) => m[1] },
      { pattern: /\b(Q[1-4]\s+\d{4})\b/i, extract: (m: RegExpMatchArray) => m[1] },
      { pattern: /\b(last|past|previous)\s+(\d+)\s+(days?|weeks?|months?|years?)\b/i, extract: (m: RegExpMatchArray) => m[0] },
      { pattern: /\b(ytd|year to date)\b/i, extract: () => 'YTD' },
      { pattern: /\b(fy\d{2,4})\b/i, extract: (m: RegExpMatchArray) => m[1] },
    ];

    for (const { pattern, extract } of timeframePatterns) {
      const match = query.match(pattern);
      if (match) {
        return extract(match);
      }
    }

    return undefined;
  }

  async createJobRecord(query: string, context?: string): Promise<string> {
    const jobData: NewResearchJob = {
      query,
      status: 'pending',
      metadata: {
        context,
        createdVia: 'query_router',
      },
    };

    const [job] = await db.insert(researchJobs).values(jobData).returning({ id: researchJobs.id });
    return job!.id;
  }

  async updateJobWithEmbedding(jobId: string, query: string): Promise<void> {
    const embedding = await embeddingService.embedQuery(query);
    await vectorStoreService.storeQueryEmbedding(jobId, query, embedding);
  }
}

export const queryRouterService = new QueryRouterService();
