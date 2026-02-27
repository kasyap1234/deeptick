import { getDb } from '../db/connection.js';
import { reportEmbeddings, researchJobs } from '../db/schema.js';
import { embeddingService } from './embedding.service.js';
import { logger } from '../utils/logger.js';
import { eq } from 'drizzle-orm';

export interface ReportIndexOptions {
  jobId: string;
  userId: string;
}

export interface ReportSearchOptions {
  userId?: string;
  query: string;
  ticker?: string;
  sector?: string;
  limit?: number;
  similarityThreshold?: number;
}

export interface IndexedReport {
  id: string;
  jobId: string;
  query: string;
  ticker?: string;
  companyName?: string;
  sector?: string;
  reportDate: Date;
  executiveSummary?: string;
  sentimentScore?: number;
  bullCaseStrength?: number;
  bearCaseStrength?: number;
  sourceCount: number;
  uniqueDomains: number;
  createdAt: Date;
  similarity: number;
}

function extractTicker(query: string): string | undefined {
  const tickerMatch = query.match(/\b([A-Z]{1,5})\b/);
  if (tickerMatch && tickerMatch[1]) {
    const commonWords = ['AI', 'LLM', 'API', 'USA', 'UK', 'EU', 'IPO', 'SEC', 'FDA', 'GDP', 'NYSE', 'NASDAQ'];
    if (!commonWords.includes(tickerMatch[1])) {
      return tickerMatch[1];
    }
  }
  return undefined;
}

function extractCompanyName(query: string): string | undefined {
  const match = query.match(/(?:analyze|research|analysis of|looking at)\s+([^,(]+)/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  return undefined;
}

export class ReportIndexerService {
  async indexReport(options: ReportIndexOptions): Promise<string | null> {
    const { jobId, userId } = options;

    try {
      const db = getDb();
      
      const job = await db
        .select()
        .from(researchJobs)
        .where(eq(researchJobs.id, jobId))
        .limit(1);

      if (!job.length || !job[0]?.result) {
        logger.warn({ jobId }, 'Job not found or has no result');
        return null;
      }

      const report = job[0].result as Record<string, unknown>;
      const query = job[0].query;

      const ticker = extractTicker(query);
      const companyName = extractCompanyName(query) || (report.companySnapshot as string)?.substring(0, 100);

      const reportText = this.buildReportText(report);
      const embedding = await embeddingService.embedQuery(reportText);

      if (!embedding) {
        logger.warn('Failed to generate embedding for report');
        return null;
      }

      const sourceCount = Array.isArray(report.sources) ? report.sources.length : 0;
      const uniqueDomains = new Set(
        (report.sources as Array<{ domain?: string }>)?.map(s => s.domain).filter(Boolean)
      ).size;

      const sentimentScore = this.calculateSentiment(report);
      const bullCaseStrength = this.calculateBullCaseStrength(report);
      const bearCaseStrength = this.calculateBearCaseStrength(report);

      const result = await db.insert(reportEmbeddings).values({
        userId,
        jobId,
        query,
        ticker: ticker ?? null,
        companyName: companyName ?? null,
        sector: null,
        reportDate: new Date(),
        embedding: embedding,
        executiveSummary: typeof report.executiveSummary === 'string' 
          ? report.executiveSummary.substring(0, 1000) 
          : null,
        reportSections: report as unknown,
        sentimentScore,
        bullCaseStrength,
        bearCaseStrength,
        sourceCount,
        uniqueDomains,
      }).returning({ id: reportEmbeddings.id });

      logger.info({ jobId, ticker }, 'Report indexed successfully');
      return result[0]!.id;
    } catch (error) {
      logger.error({ error, jobId }, 'Failed to index report');
      return null;
    }
  }

  private buildReportText(report: Record<string, unknown>): string {
    const sections: string[] = [];
    
    if (report.executiveSummary) {
      sections.push(String(report.executiveSummary));
    }
    if (report.bullCase) {
      sections.push(String(report.bullCase));
    }
    if (report.bearCase) {
      sections.push(String(report.bearCase));
    }
    if (report.businessModelAndUnitEconomics) {
      sections.push(String(report.businessModelAndUnitEconomics));
    }
    if (report.financialQualityAndTrendAnalysis) {
      sections.push(String(report.financialQualityAndTrendAnalysis));
    }
    if (report.competitivePositionAndMoat) {
      sections.push(String(report.competitivePositionAndMoat));
    }
    if (report.valuationRelative) {
      sections.push(String(report.valuationRelative));
    }
    if (report.riskFactors || report.regulatoryAndLegalRisk) {
      sections.push(String(report.riskFactors || report.regulatoryAndLegalRisk));
    }

    return sections.join('\n\n');
  }

  private calculateSentiment(report: Record<string, unknown>): number | undefined {
    const bullCase = String(report.bullCase || '');
    const bearCase = String(report.bearCase || '');
    
    const bullLength = bullCase.length;
    const bearLength = bearCase.length;
    
    if (bullLength === 0 && bearLength === 0) return undefined;
    
    const sentiment = ((bullLength - bearLength) / (bullLength + bearLength)) * 100;
    return Math.round(sentiment);
  }

  private calculateBullCaseStrength(report: Record<string, unknown>): number | undefined {
    const bullCase = String(report.bullCase || '');
    if (!bullCase) return undefined;
    
    const catalystCount = (bullCase.match(/catalyst|growth|opportunity|upside|driver/gi) || []).length;
    return Math.min(100, catalystCount * 20);
  }

  private calculateBearCaseStrength(report: Record<string, unknown>): number | undefined {
    const bearCase = String(report.bearCase || '');
    if (!bearCase) return undefined;
    
    const riskCount = (bearCase.match(/risk|threat|challenge|downside|vulnerability/gi) || []).length;
    return Math.min(100, riskCount * 20);
  }

  async searchReports(options: ReportSearchOptions): Promise<IndexedReport[]> {
    const {
      userId,
      query,
      ticker,
      sector,
      limit = 10,
      similarityThreshold = 0.7,
    } = options;

    try {
      const queryEmbedding = await embeddingService.embedQuery(query);
      
      if (!queryEmbedding) {
        logger.warn('Failed to generate embedding for report search');
        return [];
      }

      const db = getDb();
      const embeddingStr = `[${queryEmbedding.join(',')}]`;
      
      // Use native pgvector similarity search
      const sql = `
        SELECT 
          id, "jobId", query, ticker, "companyName", sector, "reportDate",
          "executiveSummary", "sentimentScore", "bullCaseStrength", 
          "bearCaseStrength", "sourceCount", "uniqueDomains", "createdAt",
          1 - (embedding <=> $1::vector) as similarity
        FROM report_embeddings
        WHERE ($2::text IS NULL OR "userId" = $2)
          AND ($3::text IS NULL OR ticker = $3)
          AND ($4::text IS NULL OR sector = $4)
        ORDER BY embedding <=> $1::vector, "reportDate" DESC
        LIMIT $5
      `;
      
      const results = await db.execute(
        sql,
        [embeddingStr, userId || null, ticker || null, sector || null, limit]
      ) as any[];

      const matches: IndexedReport[] = results
        .filter(entry => entry.similarity >= similarityThreshold)
        .map(entry => ({
          id: entry.id,
          jobId: entry.jobId,
          query: entry.query,
          ticker: entry.ticker ?? undefined,
          companyName: entry.companyName ?? undefined,
          sector: entry.sector ?? undefined,
          reportDate: entry.reportDate,
          executiveSummary: entry.executiveSummary ?? undefined,
          sentimentScore: entry.sentimentScore ?? undefined,
          bullCaseStrength: entry.bullCaseStrength ?? undefined,
          bearCaseStrength: entry.bearCaseStrength ?? undefined,
          sourceCount: entry.sourceCount,
          uniqueDomains: entry.uniqueDomains,
          createdAt: entry.createdAt,
          similarity: entry.similarity,
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

      return matches;
    } catch (error) {
      logger.error({ error }, 'Failed to search reports');
      return [];
    }
  }

  async getReportByJobId(jobId: string): Promise<IndexedReport | null> {
    const db = getDb();
    
    const results = await db
      .select()
      .from(reportEmbeddings)
      .where(eq(reportEmbeddings.jobId, jobId))
      .limit(1);

    if (!results.length) return null;

    const entry = results[0]!;
    
    return {
      id: entry.id,
      jobId: entry.jobId,
      query: entry.query,
      ticker: entry.ticker ?? undefined,
      companyName: entry.companyName ?? undefined,
      sector: entry.sector ?? undefined,
      reportDate: entry.reportDate,
      executiveSummary: entry.executiveSummary ?? undefined,
      sentimentScore: entry.sentimentScore ?? undefined,
      bullCaseStrength: entry.bullCaseStrength ?? undefined,
      bearCaseStrength: entry.bearCaseStrength ?? undefined,
      sourceCount: entry.sourceCount,
      uniqueDomains: entry.uniqueDomains,
      createdAt: entry.createdAt,
      similarity: 1,
    };
  }

  async deleteReport(jobId: string): Promise<void> {
    const db = getDb();
    
    await db
      .delete(reportEmbeddings)
      .where(eq(reportEmbeddings.jobId, jobId));
    
    logger.info({ jobId }, 'Report deleted from index');
  }
}

export const reportIndexerService = new ReportIndexerService();
