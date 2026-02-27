import { describe, expect, it } from 'vitest';
import type { InstitutionalResearchReport, ResearchSource } from '../types/research.types.js';
import { ResearchService } from './research.service.js';

function createValidReport(): InstitutionalResearchReport {
  return {
    executiveSummary: 'summary',
    companySnapshot: 'snapshot',
    industryAndMarketStructure: 'industry',
    businessModelAndUnitEconomics: 'business',
    financialQualityAndTrendAnalysis: 'financials',
    capitalAllocationReview: 'capital allocation',
    valuationRelative: 'relative valuation',
    valuationIntrinsic: 'intrinsic valuation',
    competitivePositionAndMoat: 'competitive',
    managementGovernanceAssessment: 'management',
    regulatoryAndLegalRisk: 'regulatory',
    bullCase: 'bull',
    bearCase: 'bear',
    scenarioFramework: [],
    catalystCalendar: 'calendar',
    portfolioConstructionView: 'portfolio',
    investmentConclusion: 'conclusion',
    evidenceIndex: [],
    auditReport: {
      status: 'pass',
      checkedClaims: 0,
      unresolvedClaims: [],
      notes: [],
    },
    sources: [],
  };
}

describe('research service fallback synthesis', () => {
  const service = new ResearchService();

  it('maps fallback sections from current subagent file names', () => {
    const files = {
      '/subagents/business_and_financials.md': '# Company Snapshot\nRainbow is a pediatric hospital chain with current-quarter utilization and market cap context.\n\n# Financial Quality and Trend Analysis\nRevenue and EBITDA trends show improving operating leverage with latest quarter YoY momentum.',
      '/subagents/market_and_industry.md': '# Industry and Market Structure\nThe pediatric healthcare market has strong TAM growth supported by demographics and higher insurance penetration.',
      '/subagents/valuation.md': '# Valuation Relative\nPeers trade at premium multiples and Rainbow screens slightly below the median EV/EBITDA range.',
      '/subagents/competitive_and_strategic.md': '# Competitive Position and Moat\nThe network density and specialist roster create a durable competitive moat in tier-1 cities.',
      '/subagents/thesis_and_catalysts.md': '# Bull Case\nExpansion in high-demand corridors and better payer mix could accelerate earnings trajectory over the next four quarters.\n\n# Bear Case\nExecution slippage and occupancy pressure could compress margins if costs rise faster than revenue.\n\n# Catalyst Calendar\nUpcoming earnings and guidance updates in the next two quarters can re-rate expectations.',
      '/final_report.md': '# Investment Conclusion\nBased on the latest quarter and valuation spread, risk-reward is positive with caveats on execution.',
    };
    const sources: ResearchSource[] = [{ url: 'https://example.com/source', title: 'Example' }];

    const report = (service as any).buildFallbackReport(files, 'summary', sources) as InstitutionalResearchReport;

    expect(report.companySnapshot).toContain('pediatric hospital chain');
    expect(report.industryAndMarketStructure).toContain('pediatric healthcare market');
    expect(report.valuationRelative).toContain('premium multiples');
    expect(report.competitivePositionAndMoat).toContain('durable competitive moat');
    expect(report.bullCase).toContain('Expansion in high-demand corridors');
    expect(report.bearCase).toContain('Execution slippage and occupancy pressure');
    expect(report.bullCase).not.toEqual(report.bearCase);
    expect(report.investmentConclusion).toContain('risk-reward is positive');
  });

  it('materializes valid cached JSON report without fallback', () => {
    const validReport = createValidReport();
    const materialized = (service as any).materializeCachedReport(JSON.stringify(validReport)) as {
      report: InstitutionalResearchReport;
      usedFallback: boolean;
    };

    expect(materialized.usedFallback).toBe(false);
    expect(materialized.report.executiveSummary).toBe('summary');
  });

  it('falls back to synthesized report for invalid cached JSON', () => {
    const materialized = (service as any).materializeCachedReport('not valid json') as {
      report: InstitutionalResearchReport;
      usedFallback: boolean;
    };

    expect(materialized.usedFallback).toBe(true);
    expect(materialized.report.auditReport.status).toBe('pass_with_caveats');
    expect(materialized.report.auditReport.notes[0]).toContain('Cached response format was invalid');
    // Should use 'Insufficient data' instead of 'No section generated.'
    expect(materialized.report.companySnapshot).toContain('Insufficient data');
    expect(materialized.report.companySnapshot).not.toBe('No section generated.');
  });

  it('sanitizes raw Exa JSON in fallback summary instead of dumping it', () => {
    const exaJson = JSON.stringify({
      provider: 'exa',
      query: 'KPIT Technologies analyst rating',
      results: [
        { url: 'https://example.com', title: 'Test', summary: 'KPIT has a moderate buy consensus.' },
        { url: 'https://example2.com', title: 'Test2', summary: 'The stock shows strong growth potential.' },
      ],
    });
    const sources: ResearchSource[] = [];

    const report = (service as any).buildFallbackReport({}, exaJson, sources) as InstitutionalResearchReport;

    // Should extract summaries, not contain raw JSON with 'provider' or 'query'
    expect(report.executiveSummary).toContain('KPIT has a moderate buy consensus');
    expect(report.executiveSummary).not.toContain('"provider"');
    expect(report.executiveSummary).not.toContain('"query"');
  });

  it('infers section content from files using keyword matching', () => {
    const files = {
      '/data/collected_research.md': '## Industry & Market\nThe Indian IT services sector is projected to grow to $850bn by 2035. Market TAM is expanding rapidly.',
    };
    const sources: ResearchSource[] = [];

    const report = (service as any).buildFallbackReport(files, 'A summary', sources) as InstitutionalResearchReport;

    // industryAndMarketStructure should match the file via 'market', 'industry', 'tam' keywords
    expect(report.industryAndMarketStructure).toContain('Indian IT services sector');
  });

  it('sanitizes Yahoo Finance quote JSON into readable price summary', () => {
    const yahooJson = JSON.stringify({
      symbol: 'KPITTECH.NS',
      name: 'KPIT TECHNOLOGIES LIMITED',
      currency: 'INR',
      price: 801.6,
      previousClose: 760.5,
      '52WeekHigh': 1434.5,
      '52WeekLow': 764,
      volume: 2223479,
    });
    const sources: ResearchSource[] = [];

    const report = (service as any).buildFallbackReport({}, yahooJson, sources) as InstitutionalResearchReport;

    expect(report.executiveSummary).toContain('KPIT TECHNOLOGIES LIMITED');
    expect(report.executiveSummary).toContain('801.6');
    expect(report.executiveSummary).not.toContain('"symbol"');
  });

  it('normalizes, deduplicates, and ranks sources by quality', () => {
    const ranked = (service as any).normalizeAndRankSources([
      {
        url: 'https://example.com/news?utm_source=x',
        title: 'Old duplicate',
        snippet: 'Rainbow posted results with muted growth and weak occupancy.',
        publishedDate: '2025-01-01',
        relevanceScore: 0.7,
      },
      {
        url: 'https://example.com/news',
        title: 'New duplicate',
        snippet: 'Rainbow posted results with muted growth and weak occupancy.',
        publishedDate: new Date().toISOString(),
        relevanceScore: 0.8,
      },
      {
        url: 'https://second.example.com/report',
        title: 'Independent source',
        snippet: 'Independent channel checks suggest utilization tailwinds in metro hospitals.',
        publishedDate: new Date().toISOString(),
        relevanceScore: 0.6,
      },
    ]) as ResearchSource[];

    expect(ranked.length).toBe(2);
    expect(ranked[0]?.url).toBe('https://example.com/news');
    expect(ranked[0]?.title).toBe('New duplicate');
  });

  it('builds deterministic evidence report with complete sections', () => {
    const sources: ResearchSource[] = [
      {
        url: 'https://news.example.com/cipla-quarterly',
        title: 'Cipla quarterly update beats estimates',
        snippet: 'Revenue growth and margin expansion beat consensus with supportive management commentary.',
        publishedDate: new Date().toISOString(),
        domain: 'news.example.com',
      },
      {
        url: 'https://broker.example.com/cipla-risks',
        title: 'Cipla downside risks and regulatory watch',
        snippet: 'Regulatory checks and pricing pressure remain key downside risks for near-term earnings.',
        publishedDate: new Date().toISOString(),
        domain: 'broker.example.com',
      },
    ];

    const report = (service as any).buildDeterministicReportFromEvidence({
      query: 'CIPLA stock invest now',
      sources,
      degradationReasons: ['rate_limit_429'],
    }) as InstitutionalResearchReport;

    expect(report.executiveSummary.length).toBeGreaterThan(140);
    expect(report.bullCase.length).toBeGreaterThan(180);
    expect(report.bearCase.length).toBeGreaterThan(180);
    expect(report.bullCase).not.toEqual(report.bearCase);
    expect(report.sources.length).toBe(2);
    expect(report.auditReport.status).toBe('pass_with_caveats');
  });
});
