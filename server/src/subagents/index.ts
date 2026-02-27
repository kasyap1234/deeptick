import type { SubAgent } from 'deepagents';
import type { StructuredTool } from '@langchain/core/tools';
import type { LanguageModelLike } from '@langchain/core/language_models/base';
import { exaSearchTool, exaFindSimilarTool } from '../tools/exa-tools.js';
import { config } from '../config/index.js';
import { createDigitalOceanChatModel } from '../services/deep-research/model-factory.js';

type SubAgentSpec = {
  name: string;
  description: string;
  focus: string[];
  outputFile: string;
  useSimilarityTool?: boolean;
  model?: string;
  reportSections?: string[];
};

// Custom DigitalOcean model names (e.g. "openai-gpt-oss-120b") can't be
// auto-inferred by deepagents, so we pass ChatOpenAI instances directly.
// Cast to LanguageModelLike to bridge the duplicate @langchain/core types.
const sharedModelCache = new Map<string, LanguageModelLike>();

function getSubagentModel(spec: SubAgentSpec): LanguageModelLike {
  const modelId = spec.model ?? config.deepResearch.subagentModel;
  const cached = sharedModelCache.get(modelId);
  if (cached) return cached;

  const instance = createDigitalOceanChatModel(modelId, {
    maxRetries: 1,
    maxConcurrency: 1,
    maxTokens: 4096,
    timeoutMs: 60_000,
    minRequestGapMs: 1500,
    rateLimitRetries: 4,
  }) as unknown as LanguageModelLike;

  sharedModelCache.set(modelId, instance);
  return instance;
}

function buildSubagent(spec: SubAgentSpec): SubAgent {
  // Cast needed: project's @langchain/core types conflict with deepagents'
  // bundled @langchain/core types (duplicate package issue).
  const tools = (spec.useSimilarityTool
    ? [exaSearchTool, exaFindSimilarTool]
    : [exaSearchTool]) as unknown as StructuredTool[];
  const today = new Date().toISOString().split('T')[0];
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const currentFY = new Date().getFullYear() + (new Date().getMonth() >= 3 ? 1 : 0);
  const requiresThesisSplit =
    spec.reportSections?.includes('bullCase') || spec.reportSections?.includes('bearCase');

  return {
    name: spec.name,
    description: spec.description,
    model: getSubagentModel(spec),
    tools,
    systemPrompt: `You are ${spec.name}, a specialist subagent for institutional-grade equity research.

Date: ${today}. Use FY${currentFY}/current-quarter framing and strongly prioritize sources from ${ninetyDaysAgo} onward. Always search for the LATEST data — do not rely on older figures when newer ones exist.

Task:
- Cover the focus areas below THOROUGHLY with quantified, up-to-date data.
- Run up to 8 targeted Exa searches. Prefer recent-date filters (startPublishedDate=${ninetyDaysAgo}).
- Write DETAILED analysis (at least 300 words per focus area) with specific numbers, dates, and source citations.
- Do NOT summarize — provide in-depth coverage with quantified claims.
- Include both bull and bear evidence where relevant.
- Cite every material claim as 'Source: <url>'.
- Always include the CURRENT stock price and latest quarterly financials.

Focus areas:
${spec.focus.map((item) => `- ${item}`).join('\n')}

${spec.reportSections ? `Report sections this output maps to:\n${spec.reportSections.map((s) => `- ${s}`).join('\n')}\nStructure your output with clear headings matching these sections.` : ''}

${requiresThesisSplit ? 'MANDATORY: Provide distinct `## Bull Case` and `## Bear Case` sections with non-overlapping drivers, quantified targets/downside, and dated citations for each claim.' : ''}

Output:
- Write detailed, data-rich findings to ${spec.outputFile}.
- Include key facts, quantified evidence (with dates), uncertainties, and a comprehensive source list.
- Every number must have a source URL and date.`,
  };
}

const subagentSpecs: SubAgentSpec[] = [
  {
    name: 'market-and-industry-agent',
    description: 'Assesses TAM/SAM/SOM, industry structure, economic cycle sensitivity, and macro regime dynamics.',
    focus: [
      'TAM/SAM/SOM estimates and market growth drivers',
      'Industry concentration and competitive structure',
      'Cyclical exposure, rate/inflation sensitivity, and macro regime risks',
    ],
    outputFile: 'subagents/market_and_industry.md',
    useSimilarityTool: true,
    reportSections: ['industryAndMarketStructure'],
  },
  {
    name: 'business-and-financials-agent',
    description: 'Evaluates business model, unit economics, financial statements, earnings quality, and capital allocation.',
    focus: [
      'Company overview: headquarters, founding, key products/services, employee count, market cap',
      'Revenue architecture, pricing power, and margin structure',
      'Revenue/earnings trends (last 4-8 quarters), cash flow quality, and balance sheet resilience',
      'Recurring vs non-recurring earnings and accrual quality',
      'Capital allocation: buybacks, dividends, M&A, capex efficiency, and ROIC',
      'Latest quarterly results with YoY and QoQ comparisons',
    ],
    outputFile: 'subagents/business_and_financials.md',
    reportSections: ['companySnapshot', 'businessModelAndUnitEconomics', 'financialQualityAndTrendAnalysis', 'capitalAllocationReview'],
    model: config.deepResearch.orchestratorModel, // Bucket 1: shares with orchestrator (openai-gpt-oss-20b)
  },
  {
    name: 'valuation-agent',
    description: 'Builds both relative and intrinsic valuation with peer multiples, DCF, and fair value ranges.',
    focus: [
      'Current stock price, 52-week range, and recent price action',
      'Peer set construction and forward/trailing multiples',
      'Historical valuation bands and relative positioning',
      'DCF inputs, sensitivity analysis, and terminal assumptions',
      'Range-based fair value framing with explicit upside/downside percentages',
      'Consensus analyst target prices (latest broker notes within 90 days)',
    ],
    outputFile: 'subagents/valuation.md',
    useSimilarityTool: true,
    reportSections: ['valuationRelative', 'valuationIntrinsic'],
    model: config.deepResearch.orchestratorModel, // Bucket 1: shares with orchestrator (openai-gpt-oss-20b)
  },
  {
    name: 'competitive-and-strategic-agent',
    description: 'Maps competitive landscape, moat durability, product roadmap, management quality, and governance.',
    focus: [
      'Market share, positioning, and moat sources/erosion risks',
      'Product cadence, innovation tempo, and disruption vectors',
      'Management execution track record and compensation alignment',
      'Regulatory exposure, litigation risk, and policy impact',
    ],
    outputFile: 'subagents/competitive_and_strategic.md',
    useSimilarityTool: true,
    reportSections: ['competitivePositionAndMoat', 'managementGovernanceAssessment', 'regulatoryAndLegalRisk'],
  },
  {
    name: 'thesis-and-catalysts-agent',
    description: 'Constructs bull/bear theses, tracks catalysts, and frames portfolio positioning.',
    focus: [
      'Bull thesis: core upside drivers, optionality, conditions for outperformance',
      'Bear thesis: failure modes, margin compression, impairment triggers',
      'Near-term catalysts: earnings, guidance, strategic announcements, sentiment shifts',
      'Portfolio fit: sizing logic, risk budget, correlation, and hedging',
      'Explicit answer to "is this a good investment NOW?" with reasoning',
    ],
    outputFile: 'subagents/thesis_and_catalysts.md',
    useSimilarityTool: true,
    reportSections: ['bullCase', 'bearCase', 'catalystCalendar', 'portfolioConstructionView'],
  },
  {
    name: 'india-market-agent',
    description: 'Analyzes India-specific factors: FII/DII flows, promoter holdings, sector trends, macro indicators, and stock screening.',
    focus: [
      'FII/DII buying/selling patterns and net investment flows',
      'Promoter shareholding, pledge status, and related party transactions',
      'Sector performance vs NIFTY, rotation trends, and thematic opportunities',
      'GDP growth, inflation (CPI/WPI), RBI policy, USD/INR, commodity impact',
      'Stock screening: valuation (P/E, P/B, EV/EBITDA), ROE/ROCE, debt, growth',
    ],
    outputFile: 'subagents/india_market.md',
    useSimilarityTool: true,
    model: config.deepResearch.auditorModel, // Bucket 3: shares with auditor (deepseek-r1-distill-llama-70b)
  },
  {
    name: 'evidence-and-audit-agent',
    description: 'Consolidates citations, deduplicates sources, and audits claims for sufficiency and consistency.',
    focus: [
      'Source deduplication and domain diversity checks',
      'Claim-to-source mapping and evidence graph',
      'Numerical claim verification and citation sufficiency',
      'Unresolved contradiction identification',
    ],
    outputFile: 'subagents/evidence_and_audit.md',
    useSimilarityTool: true,
    model: config.deepResearch.auditorModel,
  },
];

export const subagents: SubAgent[] = subagentSpecs.map(buildSubagent);
