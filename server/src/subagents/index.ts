import type { SubAgent } from 'deepagents';
import { exaSearchTool, exaFindSimilarTool } from '../tools/exa-tools.js';
import { config } from '../config/index.js';

type SubAgentSpec = {
  name: string;
  description: string;
  focus: string[];
  outputFile: string;
  useSimilarityTool?: boolean;
  model?: string;
};

function buildSubagent(spec: SubAgentSpec): SubAgent {
  const tools = (spec.useSimilarityTool ? [exaSearchTool, exaFindSimilarTool] : [exaSearchTool]) as any;

  return {
    name: spec.name,
    description: spec.description,
    model: spec.model ?? config.deepResearch.subagentModel,
    tools,
    systemPrompt: `You are ${spec.name}, a specialist in institutional equity research.

MANDATORY RULES:
- Use Exa tools for all web research.
- Collect broad coverage and include both bull and bear evidence.
- Extract concrete data points and cite source URLs inline with 'Source: <url>'.
- Keep output concise but information-dense.

FOCUS AREAS:
${spec.focus.map((item) => `- ${item}`).join('\n')}

OUTPUT:
- Write your findings to ${spec.outputFile}
- Include: key findings, quantified evidence, uncertainties, and a source list.`,
  } as SubAgent;
}

const subagentSpecs: SubAgentSpec[] = [
  {
    name: 'market-size-structure-agent',
    description: 'Assesses TAM/SAM/SOM, industry concentration, and structural market dynamics.',
    focus: ['TAM/SAM/SOM estimates', 'Market growth and demand drivers', 'Industry concentration and structure'],
    outputFile: 'subagents/market_size_structure.md',
    useSimilarityTool: true,
  },
  {
    name: 'industry-cycle-agent',
    description: 'Analyzes economic cycle sensitivity and regime dependence.',
    focus: ['Cyclical exposure', 'Rate/inflation sensitivity', 'Macro regime risks and tailwinds'],
    outputFile: 'subagents/industry_cycle.md',
  },
  {
    name: 'business-model-agent',
    description: 'Evaluates the business model, pricing power, and unit economics.',
    focus: ['Revenue architecture', 'Pricing power and margin structure', 'Unit economics and scalability'],
    outputFile: 'subagents/business_model.md',
  },
  {
    name: 'financial-statements-agent',
    description: 'Extracts and trends financial statement metrics.',
    focus: ['Revenue and earnings trends', 'Cash flow quality', 'Balance sheet resilience'],
    outputFile: 'subagents/financial_statements.md',
  },
  {
    name: 'quality-of-earnings-agent',
    description: 'Checks earnings quality, accruals, and accounting anomalies.',
    focus: ['Recurring vs non-recurring earnings', 'Accrual quality', 'Accounting policy risks'],
    outputFile: 'subagents/quality_of_earnings.md',
  },
  {
    name: 'capital-allocation-agent',
    description: 'Analyzes management capital allocation effectiveness.',
    focus: ['Buybacks/dividends', 'M&A execution', 'Capex efficiency and ROIC'],
    outputFile: 'subagents/capital_allocation.md',
  },
  {
    name: 'valuation-multiples-agent',
    description: 'Builds relative valuation and peer multiple context.',
    focus: ['Peer set construction', 'Forward and trailing multiples', 'Historical valuation bands'],
    outputFile: 'subagents/valuation_multiples.md',
  },
  {
    name: 'valuation-intrinsic-agent',
    description: 'Builds intrinsic valuation assumptions and ranges.',
    focus: ['DCF inputs and sensitivity', 'Terminal assumptions', 'Range-based fair value framing'],
    outputFile: 'subagents/valuation_intrinsic.md',
  },
  {
    name: 'competitive-landscape-agent',
    description: 'Maps competitive landscape and moat durability.',
    focus: ['Market share and positioning', 'Moat sources and erosion risks', 'Switching costs and barriers to entry'],
    outputFile: 'subagents/competitive_landscape.md',
    useSimilarityTool: true,
  },
  {
    name: 'product-technology-agent',
    description: 'Assesses product roadmap and technology disruption risk.',
    focus: ['Product cadence and roadmap', 'Innovation tempo', 'Disruption vectors'],
    outputFile: 'subagents/product_technology.md',
  },
  {
    name: 'management-governance-agent',
    description: 'Evaluates leadership quality and governance alignment.',
    focus: ['Management execution track record', 'Compensation alignment', 'Governance concerns'],
    outputFile: 'subagents/management_governance.md',
  },
  {
    name: 'regulatory-legal-agent',
    description: 'Researches legal, policy, and regulatory constraints.',
    focus: ['Regulatory exposure', 'Litigation risk', 'Policy changes impacting economics'],
    outputFile: 'subagents/regulatory_legal.md',
  },
  {
    name: 'news-catalyst-agent',
    description: 'Tracks near-term catalysts and event-driven risks.',
    focus: ['Earnings and guidance events', 'Strategic announcements', 'Material sentiment shifts'],
    outputFile: 'subagents/news_catalysts.md',
  },
  {
    name: 'bull-thesis-agent',
    description: 'Constructs upside thesis with quantified drivers.',
    focus: ['Core upside drivers', 'Optionality vectors', 'Conditions for outperformance'],
    outputFile: 'subagents/bull_thesis.md',
  },
  {
    name: 'bear-thesis-agent',
    description: 'Constructs downside thesis with impairment triggers.',
    focus: ['Failure modes', 'Margin/value compression drivers', 'Conditions for underperformance'],
    outputFile: 'subagents/bear_thesis.md',
  },
  {
    name: 'portfolio-fit-agent',
    description: 'Frames the position in a portfolio context.',
    focus: ['Sizing logic', 'Risk budget implications', 'Correlation and hedging considerations'],
    outputFile: 'subagents/portfolio_fit.md',
  },
  {
    name: 'evidence-librarian-agent',
    description: 'Consolidates, deduplicates, and organizes citations and evidence graph.',
    focus: ['Source deduplication', 'Claim-to-source mapping', 'Domain diversity checks'],
    outputFile: 'subagents/evidence_librarian.md',
    useSimilarityTool: true,
  },
  {
    name: 'india-fii-dii-agent',
    description: 'Analyzes Foreign Institutional Investor (FII) and Domestic Institutional Investor (DII) flows.',
    focus: ['FII buying/selling patterns', 'DII activity and trends', 'Net investment flows by category', 'Impact on stock movements'],
    outputFile: 'subagents/india_fii_dii.md',
    useSimilarityTool: true,
  },
  {
    name: 'india-promoter-holdings-agent',
    description: 'Tracks promoter holdings, pledges, and stakeholder changes.',
    focus: ['Promoter shareholding percentage', 'Pledge status changes', 'Stakeholder activism', 'Related party transactions'],
    outputFile: 'subagents/india_promoter_holdings.md',
  },
  {
    name: 'india-sector-analysis-agent',
    description: 'Analyzes sector performance, rotation, and thematic trends in Indian market.',
    focus: ['Sector performance vs NIFTY', 'Sector rotation trends', 'Thematic opportunities', 'Sector correlations'],
    outputFile: 'subagents/india_sector_analysis.md',
    useSimilarityTool: true,
  },
  {
    name: 'india-macro-indicator-agent',
    description: 'Tracks Indian macro indicators: GDP, inflation, RBI policy, currency, commodities.',
    focus: ['GDP growth trends', 'Inflation (CPI/WPI)', 'RBI monetary policy', 'USD/INR currency', 'Commodity impact'],
    outputFile: 'subagents/india_macro_indicators.md',
    useSimilarityTool: true,
  },
  {
    name: 'india-stock-screen-agent',
    description: 'Screens Indian stocks using fundamental metrics (P/E, ROE, debt, growth).',
    focus: ['Valuation metrics (P/E, P/B, EV/EBITDA)', 'Return ratios (ROE, ROCE)', 'Debt levels and coverage', 'Growth rates'],
    outputFile: 'subagents/india_stock_screen.md',
  },
  {
    name: 'compliance-auditor-agent',
    description: 'Audits final claims for citation sufficiency and consistency.',
    focus: ['Numerical claim verification', 'Citation sufficiency', 'Unresolved contradiction list'],
    outputFile: 'subagents/compliance_audit.md',
  model: config.deepResearch.auditorModel,
  },
];

export const subagents: SubAgent[] = subagentSpecs.map(buildSubagent);
