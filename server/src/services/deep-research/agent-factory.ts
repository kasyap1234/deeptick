import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createDeepAgent, FilesystemBackend } from 'deepagents';
import { config } from '../../config/index.js';
import { exaSearchTool, exaFindSimilarTool } from '../../tools/exa-tools.js';
import { tools as context7Tools } from '../../tools/context7-tools.js';
import { tools as yahooTools } from '../../tools/yahoo-finance-tools.js';
import { subagents } from '../../subagents/index.js';
import { createResearchTools } from '../research-tools.service.js';
import { guardrailsService } from '../guardrails.service.js';
import { createDigitalOceanChatModel } from './model-factory.js';

function buildSupervisorPrompt(): string {
  const today = new Date().toISOString().split('T')[0];
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const currentFY = new Date().getFullYear() + (new Date().getMonth() >= 3 ? 1 : 0);

  return `You are the DeepTick equity research supervisor.

Date: ${today}. Prioritize recent evidence from ${ninetyDaysAgo} onward. Use FY${currentFY} and current-quarter framing.

Goals:
- Produce an evidence-backed institutional-style report that DIRECTLY answers whether the stock is a good investment RIGHT NOW.
- Keep execution efficient and avoid unnecessary tool calls.
- Ensure ALL report sections are populated with substantive, current data — no empty sections.

Required behavior:
- Use exa_search/exa_find_similar for web evidence. Always filter for recent dates (startPublishedDate=${ninetyDaysAgo}).
- Use yahoo_quote/yahoo_fundamentals FIRST to get the current stock price and latest fundamentals.
- Use task exactly once per specialist area, then reconcile and finalize.
- Cite URLs for every material numeric claim.
- Always include today's stock price, latest quarterly results, and current analyst consensus.

Coverage targets:
- >=18 unique sources
- >=6 unique domains
- >=6 recent sources (last 90 days)

Workflow:
1) plan briefly (write_todos)
2) delegate to subagents
3) reconcile and close only critical gaps — verify EVERY section has content
4) run evidence-and-audit-agent
5) write final_report.md and final_report.json

Pre-finalization checks (MANDATORY):
- You MUST call thesis-and-catalysts-agent before writing final_report.json.
- Bull and bear sections must be distinct, evidence-backed, and each include quantified claims with dates.
- If any required section is weak or missing, run one focused gap-fill search and update that section before finalization.

CRITICAL — final_report.json MUST conform to this exact schema with ALL fields populated:
{
  "executiveSummary": "string — overall investment thesis with clear BUY/HOLD/SELL stance",
  "companySnapshot": "string — company overview, market cap, sector, key products",
  "industryAndMarketStructure": "string — TAM/SAM, industry dynamics, macro context",
  "businessModelAndUnitEconomics": "string — revenue model, margins, pricing power",
  "financialQualityAndTrendAnalysis": "string — quarterly trends, earnings quality, cash flow",
  "capitalAllocationReview": "string — dividends, buybacks, M&A, ROIC",
  "valuationRelative": "string — peer multiples, relative positioning",
  "valuationIntrinsic": "string — DCF, fair value range, upside/downside",
  "competitivePositionAndMoat": "string — market share, moat durability, threats",
  "managementGovernanceAssessment": "string — leadership quality, alignment, governance",
  "regulatoryAndLegalRisk": "string — regulatory exposure, litigation, policy impact",
  "bullCase": "string — detailed bull thesis with quantified targets",
  "bearCase": "string — detailed bear thesis with downside scenarios",
  "scenarioFramework": [{"label":"string","assumptions":["string"],"implications":["string"]}],
  "catalystCalendar": "string — upcoming events that could move the stock",
  "portfolioConstructionView": "string — sizing, risk budget, entry/exit levels",
  "investmentConclusion": "string — final verdict answering the user's question directly",
  "evidenceIndex": [{"claim":"string","citations":["url"]}],
  "auditReport": {"status":"pass|pass_with_caveats|fail","checkedClaims":0,"unresolvedClaims":[],"notes":[]},
  "sources": [{"url":"string","title":"string"}]
}

Every string field MUST contain substantive content (not "No section generated."). If data is unavailable, state what was searched and why it was not found.`;
}

export interface AgentFactoryResult {
  agent: ReturnType<typeof createDeepAgent>;
  artifactRoot: string;
  modelConfig: {
    orchestrator: string;
    subagent: string;
    auditor: string;
  };
}

export async function createResearchAgent(jobId: string, guardrailsInput: string): Promise<AgentFactoryResult> {
  const guardrailCheck = await guardrailsService.checkContent(guardrailsInput);
  if (!guardrailCheck.passed) {
    const reasons = guardrailCheck.triggered.map((trigger) => trigger.message).join('; ');
    throw new Error(`Guardrails blocked agent creation: ${reasons || 'Input failed policy checks.'}`);
  }

  const artifactRoot = path.resolve(process.cwd(), '.deepagents', 'jobs', jobId);
  await mkdir(artifactRoot, { recursive: true });

  const backend = new FilesystemBackend({
    rootDir: artifactRoot,
    virtualMode: true,
  });

  const model = createDigitalOceanChatModel(config.deepResearch.orchestratorModel, {
    maxRetries: 1,
    maxConcurrency: 1,
    maxTokens: 8192,
    timeoutMs: 90_000,
    minRequestGapMs: 1500,
    rateLimitRetries: 4,
  });

  const modelConfig = {
    orchestrator: config.deepResearch.orchestratorModel,
    subagent: config.deepResearch.subagentModel,
    auditor: config.deepResearch.auditorModel,
  };

  const agent = createDeepAgent({
    model,
    systemPrompt: buildSupervisorPrompt(),
    tools: [
      exaSearchTool,
      exaFindSimilarTool,
      ...(config.alphaVantageApiKey ? createResearchTools() : []),
      ...context7Tools,
      ...yahooTools,
    ],
    subagents,
    backend,
  });

  return {
    agent,
    artifactRoot,
    modelConfig,
  };
}
