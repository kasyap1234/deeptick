import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createDeepAgent, FilesystemBackend } from 'deepagents';
import { config } from '../../config/index.js';
import { exaSearchTool, exaFindSimilarTool } from '../../tools/exa-tools.js';
import { subagents } from '../../subagents/index.js';

const supervisorPrompt = `You are an institutional-grade equity research orchestrator for retail investors.

MISSION:
Produce a comprehensive, evidence-backed investment report that matches institutional research depth.

NON-NEGOTIABLE RULES:
- Use Exa tools for ALL external web research.
- Use write_todos to plan and track progress.
- Use the task tool to delegate complex work to specialist subagents.
- Parallelize independent subagent tasks to improve coverage.
- Collect broad and diverse evidence before concluding.
- Every material numerical claim must be tied to source URLs.

RESEARCH DEPTH TARGETS:
- At least 80 unique sources
- At least 12 unique domains
- At least 25 sources from the last 90 days
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
- Use concise, testable claims, not vague statements.`;

export interface AgentFactoryResult {
  agent: ReturnType<typeof createDeepAgent>;
  artifactRoot: string;
  modelConfig: {
    orchestrator: string;
    subagent: string;
    auditor: string;
  };
}

export async function createResearchAgent(jobId: string): Promise<AgentFactoryResult> {
  const artifactRoot = path.resolve(process.cwd(), '.deepagents', 'jobs', jobId);
  await mkdir(artifactRoot, { recursive: true });

  const backend = new FilesystemBackend({
    rootDir: artifactRoot,
    virtualMode: true,
  });

  const modelConfig = {
    orchestrator: config.DEEP_RESEARCH_ORCHESTRATOR_MODEL,
    subagent: config.DEEP_RESEARCH_SUBAGENT_MODEL,
    auditor: config.DEEP_RESEARCH_AUDITOR_MODEL,
  };

  const agent = createDeepAgent({
    model: modelConfig.orchestrator,
    systemPrompt: supervisorPrompt,
    tools: [exaSearchTool, exaFindSimilarTool],
    subagents,
    backend,
  });

  return {
    agent,
    artifactRoot,
    modelConfig,
  };
}
