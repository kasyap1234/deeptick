import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createDeepAgent, FilesystemBackend } from 'deepagents';
import { ChatOpenAI } from '@langchain/openai';
import { config, normalizeModelForOpenAICompatible } from '../../config/index.js';
import { exaSearchTool, exaFindSimilarTool } from '../../tools/exa-tools.js';
import { tools as context7Tools } from '../../tools/context7-tools.js';
import { tools as yahooTools } from '../../tools/yahoo-finance-tools.js';
import { subagents } from '../../subagents/index.js';
import { createResearchTools } from '../research-tools.service.js';
import { guardrailsService } from '../guardrails.service.js';

function buildSupervisorPrompt(): string {
  const today = new Date().toISOString().split('T')[0];
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const currentFY = new Date().getFullYear() + (new Date().getMonth() >= 3 ? 1 : 0);

  return `You are an institutional-grade equity research orchestrator for retail investors.

Today's date: ${today}. Use FY${currentFY} and current quarter references. When searching for recent data, prioritize content from the last 90 days (since ${ninetyDaysAgo}).

MISSION:
Produce a comprehensive, evidence-backed investment report that matches institutional research depth.

NON-NEGOTIABLE RULES:
- Use Exa tools for ALL external web research.
- Use get_stock_info to get real-time stock prices and trading data.
- Use search_financial_news to get the latest news about companies.
- Use get_financial_statements to retrieve income statements, balance sheets, and cash flow data.
- Use get_technical_indicators for technical analysis (SMA, EMA, RSI, MACD, Bollinger Bands).
- Use write_todos to plan and track progress.
- Use the task tool to delegate complex work to specialist subagents.
- Parallelize independent subagent tasks to improve coverage.
- Collect broad and diverse evidence before concluding.
- Every material numerical claim must be tied to source URLs.

RESEARCH DEPTH TARGETS:
- At least 80 unique sources
- At least 12 unique domains
- At least 25 sources from the last 90 days (i.e., since ${ninetyDaysAgo})
- At least 2 independent citations for each material numerical claim

WORKFLOW:
1) Planning: create detailed todo list and wave plan.
2) Delegation: assign specialized subagents with clear output expectations.
3) Reconciliation: merge outputs and identify evidence gaps.
4) Gap closure: run additional Exa searches until thresholds are met.
5) Audit: run compliance-auditor-agent and resolve findings.
6) Finalization: write both final_report.md and final_report.json.

FINAL OUTPUT FORMAT REQUIREMENTS:
- final_report.json must contain all report sections and an evidenceIndex.
- Include an auditReport block with pass/fail/caveats.
- Use concise, testable claims, not vague statements.

SAFETY:
- Never provide investment advice. Present information objectively.
- Include appropriate disclaimers about investment risks.
- Flag any conflicts of interest.`;
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

  let model: ChatOpenAI;

  if (config.openaiApiKey) {
    model = new ChatOpenAI({
      model: 'gpt-4o',
      apiKey: config.openaiApiKey,
    });
  } else if (config.anthropicApiKey) {
    model = new ChatOpenAI({
      model: 'claude-sonnet-4-20250514',
      apiKey: config.anthropicApiKey,
      configuration: {
        baseURL: 'https://api.anthropic.com',
      },
    });
  } else if (config.DO_GENAI_API_KEY) {
    model = new ChatOpenAI({
      model: normalizeModelForOpenAICompatible(config.deepResearch.orchestratorModel),
      apiKey: config.DO_GENAI_API_KEY,
      configuration: {
        baseURL: config.DO_GENAI_ENDPOINT,
        defaultHeaders: {
          'Authorization': `Bearer ${config.DO_GENAI_API_KEY}`,
        },
      },
    });
  } else {
    throw new Error('No LLM provider configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or DO_GENAI_API_KEY.');
  }

  const modelConfig = {
    orchestrator: config.deepResearch.orchestratorModel,
    subagent: config.deepResearch.subagentModel,
    auditor: config.deepResearch.auditorModel,
  };

  const agent = createDeepAgent({
    model,
    systemPrompt: buildSupervisorPrompt(),
    tools: [exaSearchTool, exaFindSimilarTool, ...createResearchTools(), ...context7Tools, ...yahooTools],
    subagents,
    backend,
  });

  return {
    agent,
    artifactRoot,
    modelConfig,
  };
}
