"use client";

import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  Download,
  Share2,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Globe,
  FileText,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ResearchJob, InstitutionalResearchReport, ResearchSource } from "@/lib/types";

interface ResearchReportViewProps {
  job: ResearchJob;
  onBack?: () => void;
}

const auditStatusConfig = {
  pass: { icon: CheckCircle, color: "text-emerald-500", bgColor: "bg-emerald-500/10", borderColor: "border-emerald-500/20", label: "Verified" },
  pass_with_caveats: { icon: AlertTriangle, color: "text-amber-500", bgColor: "bg-amber-500/10", borderColor: "border-amber-500/20", label: "Verified with Caveats" },
  fail: { icon: XCircle, color: "text-red-500", bgColor: "bg-red-500/10", borderColor: "border-red-500/20", label: "Failed Verification" },
};

export function ResearchReportView({ job, onBack }: ResearchReportViewProps) {
  const report = job.result;
  if (!report) return null;

  const auditStatus = auditStatusConfig[report.auditReport.status];
  const AuditIcon = auditStatus.icon;

  const formatDate = (dateStr: string) => {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(dateStr));
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
      className="h-full flex flex-col"
    >
      <div className="flex items-center justify-between p-6 border-b border-border/50">
        <div className="flex items-center gap-4">
          {onBack && (
            <Button variant="ghost" size="icon" onClick={onBack}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <div>
            <h2 className="text-xl font-semibold gradient-text">{job.query}</h2>
            <p className="text-sm text-muted-foreground">
              Generated on {formatDate(job.createdAt)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2">
            <Share2 className="h-4 w-4" />
            Share
          </Button>
          <Button variant="outline" size="sm" className="gap-2">
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-6 space-y-6">
          <Card className="gradient-card border-border/50">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <AuditIcon className={cn("h-5 w-5", auditStatus.color)} />
                  Audit Status
                </CardTitle>
                <Badge className={cn(auditStatus.bgColor, auditStatus.color)}>
                  {auditStatus.label}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-sm text-muted-foreground">
                {report.auditReport.checkedClaims} claims checked
                {report.auditReport.unresolvedClaims.length > 0 && (
                  <>, {report.auditReport.unresolvedClaims.length} unresolved issues</>
                )}
              </p>
            </CardContent>
          </Card>

          <Tabs defaultValue="summary" className="w-full">
            <TabsList className="w-full justify-start gap-1 bg-transparent border-b border-border/50 rounded-none h-auto p-0">
              <TabsTrigger value="summary" className="rounded-md data-[state=active]:bg-secondary data-[state=active]:shadow-sm">Executive Summary</TabsTrigger>
              <TabsTrigger value="bull" className="rounded-md data-[state=active]:bg-secondary data-[state=active]:shadow-sm">Bull Case</TabsTrigger>
              <TabsTrigger value="bear" className="rounded-md data-[state=active]:bg-secondary data-[state=active]:shadow-sm">Bear Case</TabsTrigger>
              <TabsTrigger value="scenarios" className="rounded-md data-[state=active]:bg-secondary data-[state=active]:shadow-sm">Scenarios</TabsTrigger>
              <TabsTrigger value="sources" className="rounded-md data-[state=active]:bg-secondary data-[state=active]:shadow-sm">Sources</TabsTrigger>
            </TabsList>

            <TabsContent value="summary" className="mt-6 space-y-4">
              <MarkdownSection title="Executive Summary" content={report.executiveSummary} />
              <MarkdownSection title="Company Snapshot" content={report.companySnapshot} />
              <MarkdownSection title="Industry & Market Structure" content={report.industryAndMarketStructure} />
              <MarkdownSection title="Business Model" content={report.businessModelAndUnitEconomics} />
              <MarkdownSection title="Financial Analysis" content={report.financialQualityAndTrendAnalysis} />
              <MarkdownSection title="Competitive Position" content={report.competitivePositionAndMoat} />
              <MarkdownSection title="Investment Conclusion" content={report.investmentConclusion} />
            </TabsContent>

            <TabsContent value="bull" className="mt-6">
              <MarkdownSection title="Bull Case Thesis" content={report.bullCase} />
            </TabsContent>

            <TabsContent value="bear" className="mt-6">
              <MarkdownSection title="Bear Case Thesis" content={report.bearCase} />
            </TabsContent>

            <TabsContent value="scenarios" className="mt-6">
              <div className="grid gap-4">
                {report.scenarioFramework.map((scenario, index) => (
                  <Card key={index} className="gradient-card border-border/50">
                    <CardHeader>
                      <CardTitle className="text-lg">{scenario.label}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <h5 className="text-sm font-medium mb-2">Assumptions</h5>
                        <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                          {scenario.assumptions.map((assumption, i) => (
                            <li key={i}>{assumption}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h5 className="text-sm font-medium mb-2">Implications</h5>
                        <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                          {scenario.implications.map((implication, i) => (
                            <li key={i}>{implication}</li>
                          ))}
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="sources" className="mt-6">
              <div className="grid gap-3">
                {report.sources.map((source, index) => (
                  <SourceCard key={index} source={source} index={index} />
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </motion.div>
  );
}

function MarkdownSection({ title, content }: { title: string; content: string }) {
  return (
    <Card className="gradient-card border-border/50">
      <CardHeader>
        <CardTitle className="text-base font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="prose prose-invert prose-sm max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      </CardContent>
    </Card>
  );
}

function SourceCard({ source, index }: { source: ResearchSource; index: number }) {
  return (
    <Collapsible>
      <Card className="gradient-card border-border/50">
        <CollapsibleTrigger className="w-full">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-primary/10">
                <Globe className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <h4 className="font-medium text-sm truncate">{source.title}</h4>
                <p className="text-xs text-muted-foreground truncate">
                  {source.domain || new URL(source.url).hostname}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {source.relevanceScore && (
                  <Badge variant="secondary" className="text-xs">
                    {(source.relevanceScore * 100).toFixed(0)}% match
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 px-4 pb-4">
            <Separator className="mb-3" />
            {source.snippet && (
              <p className="text-sm text-muted-foreground mb-3">{source.snippet}</p>
            )}
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Visit Source
            </a>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
