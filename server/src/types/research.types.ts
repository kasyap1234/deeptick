import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

export type ResearchStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export const ResearchSourceSchema = Type.Object({
  url: Type.String(),
  title: Type.String(),
  snippet: Type.Optional(Type.String()),
  relevanceScore: Type.Optional(Type.Number()),
  sourceType: Type.Optional(Type.String()),
  publishedDate: Type.Optional(Type.String()),
  domain: Type.Optional(Type.String()),
});

export const ScenarioSchema = Type.Object({
  label: Type.String(),
  assumptions: Type.Array(Type.String()),
  implications: Type.Array(Type.String()),
  probability: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
});

export const EvidenceEntrySchema = Type.Object({
  claim: Type.String(),
  citations: Type.Array(Type.String()),
  confidence: Type.Optional(Type.String()),
});

export const AuditIssueSchema = Type.Object({
  claim: Type.String(),
  reason: Type.String(),
  severity: Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')]),
});

export const AuditReportSchema = Type.Object({
  status: Type.Union([Type.Literal('pass'), Type.Literal('pass_with_caveats'), Type.Literal('fail')]),
  checkedClaims: Type.Number(),
  unresolvedClaims: Type.Array(AuditIssueSchema),
  notes: Type.Array(Type.String()),
});

export const InstitutionalResearchReportSchema = Type.Object({
  executiveSummary: Type.String(),
  companySnapshot: Type.String(),
  industryAndMarketStructure: Type.String(),
  businessModelAndUnitEconomics: Type.String(),
  financialQualityAndTrendAnalysis: Type.String(),
  capitalAllocationReview: Type.String(),
  valuationRelative: Type.String(),
  valuationIntrinsic: Type.String(),
  competitivePositionAndMoat: Type.String(),
  managementGovernanceAssessment: Type.String(),
  regulatoryAndLegalRisk: Type.String(),
  bullCase: Type.String(),
  bearCase: Type.String(),
  scenarioFramework: Type.Array(ScenarioSchema),
  catalystCalendar: Type.String(),
  portfolioConstructionView: Type.String(),
  investmentConclusion: Type.String(),
  evidenceIndex: Type.Array(EvidenceEntrySchema),
  auditReport: AuditReportSchema,
  sources: Type.Array(ResearchSourceSchema),
});

export type ResearchSource = Static<typeof ResearchSourceSchema>;
export type InstitutionalResearchReport = Static<typeof InstitutionalResearchReportSchema>;

export interface ResearchJob {
  id: string;
  userId: string;
  query: string;
  status: ResearchStatus;
  createdAt: Date;
  updatedAt: Date;
  result?: InstitutionalResearchReport;
  error?: string;
  metadata?: ResearchMetadata;
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
}

export interface ResearchRequest {
  userId?: string;
  query: string;
  context?: string;
  focusAreas?: string[];
  maxResults?: number;
}

export interface WebSocketMessage {
  type: 'status' | 'progress' | 'result' | 'error';
  jobId: string;
  payload: unknown;
  timestamp: Date;
}

export interface WebSocketLike {
  send(data: string): void;
  readyState?: number;
}

export function isInstitutionalResearchReport(value: unknown): value is InstitutionalResearchReport {
  return Value.Check(InstitutionalResearchReportSchema, value);
}
