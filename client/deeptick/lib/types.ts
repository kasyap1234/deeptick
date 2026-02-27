export interface ResearchSource {
  url: string;
  title: string;
  snippet?: string;
  relevanceScore?: number;
  sourceType?: string;
  publishedDate?: string;
  domain?: string;
}

export interface AuditIssue {
  claim: string;
  reason: string;
  severity: 'low' | 'medium' | 'high';
}

export interface AuditReport {
  status: 'pass' | 'pass_with_caveats' | 'fail';
  checkedClaims: number;
  unresolvedClaims: AuditIssue[];
  notes: string[];
}

export interface Scenario {
  label: string;
  assumptions: string[];
  implications: string[];
  probability?: number;
}

export interface EvidenceEntry {
  claim: string;
  citations: string[];
  confidence?: string;
}

export interface InstitutionalResearchReport {
  executiveSummary: string;
  companySnapshot: string;
  industryAndMarketStructure: string;
  businessModelAndUnitEconomics: string;
  financialQualityAndTrendAnalysis: string;
  capitalAllocationReview: string;
  valuationRelative: string;
  valuationIntrinsic: string;
  competitivePositionAndMoat: string;
  managementGovernanceAssessment: string;
  regulatoryAndLegalRisk: string;
  bullCase: string;
  bearCase: string;
  scenarioFramework: Scenario[];
  catalystCalendar: string;
  portfolioConstructionView: string;
  investmentConclusion: string;
  evidenceIndex: EvidenceEntry[];
  auditReport: AuditReport;
  sources: ResearchSource[];
}

export interface ResearchMetadata {
  todoList?: string[];
  files?: Record<string, string>;
  duration?: number;
  sourceMetrics?: {
    uniqueSources: number;
    domainCount: number;
    recentSourceCount: number;
  };
  orchestrationMetrics?: {
    subagentCountUsed: number;
    taskCount: number;
  };
  auditStatus?: 'pass' | 'pass_with_caveats' | 'fail';
  artifactRoot?: string;
  modelConfigUsed?: {
    orchestrator: string;
    subagent: string;
    auditor: string;
  };
  gradientAgentId?: string;
  gradientKnowledgeBaseId?: string;
  useGradientNative?: boolean;
  failureCode?: 'rate_limited' | 'timeout' | 'tool_budget_exceeded' | 'subagent_budget_exceeded' | 'recursion_limit_reached' | 'provider_error' | 'guardrails_blocked' | 'insufficient_research_output' | 'invalid_cached_report' | 'unknown_error';
  failureStage?: string;
  timedOutAt?: string;
  budgetMetrics?: {
    toolCalls: number;
    subagentCalls: number;
    elapsedMs: number;
  };
}

export type ResearchStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface ResearchJob {
  id: string;
  query: string;
  status: ResearchStatus;
  createdAt: string;
  updatedAt: string;
  result?: InstitutionalResearchReport;
  error?: string;
  metadata?: ResearchMetadata;
}

export interface Conversation {
  id: string;
  title: string;
  context?: {
    currentStock?: string;
    currentSector?: string;
    lastResearchJobId?: string;
    metadata?: Record<string, unknown>;
  };
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: ResearchSource[];
  jobId?: string;
  createdAt: string;
}

export interface ChatMessageResponse {
  messageId: string;
  conversationId: string;
  role: 'assistant';
  content: string;
  sources?: ResearchSource[];
  researchJobId?: string;
  cached?: boolean;
}

export interface StreamChunk {
  messageId: string;
  content: string;
  isComplete: boolean;
  sources?: ResearchSource[];
  researchJobId?: string;
}

export interface WebSocketMessage {
  type: 'status' | 'progress' | 'result' | 'error' | 'chat_message' | 'stream_chunk' | 'stream_complete';
  jobId?: string;
  conversationId?: string;
  payload?: unknown;
  content?: string;
  messageId?: string;
  isComplete?: boolean;
  sources?: ResearchSource[];
  researchJobId?: string;
  error?: string;
  timestamp: string;
}

export interface SubAgentActivity {
  id: string;
  name: string;
  status: 'started' | 'running' | 'completed' | 'failed';
  detail?: string;
  timestamp: string;
}

export interface ProgressUpdate {
  stage: string;
  status?: ResearchStatus;
  uniqueSources?: number;
  domainCount?: number;
  expectedSubagents?: number;
  completedSubagents?: number;
  urls?: string[];
  reasoning?: string[];
  subAgentActivities?: SubAgentActivity[];
}
