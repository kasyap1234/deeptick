"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  Download,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ExternalLink,
  BookOpen,
  Eye,
  Activity,
  Briefcase,
  Layers,
  ChevronDown,
  Printer
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { ResearchJob, ResearchSource } from "@/lib/types";

interface ResearchReportViewProps {
  job: ResearchJob;
  onBack?: () => void;
}

const auditStatusConfig = {
  pass: { icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/20", label: "Verified Data" },
  pass_with_caveats: { icon: AlertTriangle, color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20", label: "Verified with Caveats" },
  fail: { icon: XCircle, color: "text-rose-500", bg: "bg-rose-500/10", border: "border-rose-500/20", label: "Unverified" },
};

const fallbackAuditStatus = { icon: Activity, color: "text-muted-foreground", bg: "bg-muted/10", border: "border-muted/20", label: "Pending Verification" };

export function ResearchReportView({ job, onBack }: ResearchReportViewProps) {
  const [activeTab, setActiveTab] = useState("summary");
  const [isPrinting, setIsPrinting] = useState(false);
  const report = job.result;

  useEffect(() => {
    // Revert state when print dialog is closed
    const handleAfterPrint = () => setIsPrinting(false);
    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
  }, []);

  if (!report) return null;

  const auditStatus = report.auditReport?.status
    ? (auditStatusConfig[report.auditReport.status] ?? fallbackAuditStatus)
    : fallbackAuditStatus;
  const AuditIcon = auditStatus.icon;

  const scenarios = Array.isArray(report.scenarioFramework) ? report.scenarioFramework : [];
  const sources = Array.isArray(report.sources) ? report.sources : [];

  const formatDate = (dateStr: string) => {
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric"
    }).format(new Date(dateStr));
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify({ job }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `deeptick-research-${job.id.substring(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleGeneratePDF = () => {
    setIsPrinting(true);
    setTimeout(() => {
      window.print();
    }, 500); // give DOM time to re-render everything
  };

  const tabs = [
    { id: "summary", label: "Executive Summary", icon: Briefcase },
    { id: "bull", label: "Bull Case", icon: Activity },
    { id: "bear", label: "Bear Case", icon: Eye },
    { id: "scenarios", label: "Scenarios", icon: Layers },
    { id: "sources", label: "Sources", icon: BookOpen },
  ];

  const renderSections = () => {
    return (
      <div className={cn(isPrinting && "print:w-full print:max-w-none text-black")}>
        {(activeTab === "summary" || isPrinting) && (
          <div className="space-y-20 break-inside-avoid-page">
            <MarkdownSection title="Executive Summary" content={report.executiveSummary} />
            <MarkdownSection title="Company Snapshot" content={report.companySnapshot} />
            <MarkdownSection title="Industry & Market Structure" content={report.industryAndMarketStructure} />
            <MarkdownSection title="Business Model" content={report.businessModelAndUnitEconomics} />
            <MarkdownSection title="Financial Analysis" content={report.financialQualityAndTrendAnalysis} />
            <MarkdownSection title="Competitive Position" content={report.competitivePositionAndMoat} />
            <MarkdownSection title="Investment Conclusion" content={report.investmentConclusion} />
          </div>
        )}

        {(activeTab === "bull" || isPrinting) && (
          <div className={cn(isPrinting && "break-before-page pt-10")}>
            {isPrinting && <h2 className="text-3xl font-serif font-medium border-b-[1.5px] border-black/20 pb-4 mb-10 text-black">Bull Case Thesis</h2>}
            <MarkdownSection title="Bull Case Thesis" content={report.bullCase} />
          </div>
        )}

        {(activeTab === "bear" || isPrinting) && (
          <div className={cn(isPrinting && "mt-16 break-before-page pt-10")}>
            {isPrinting && <h2 className="text-3xl font-serif font-medium border-b-[1.5px] border-black/20 pb-4 mb-10 text-black">Bear Case Thesis</h2>}
            <MarkdownSection title="Bear Case Thesis" content={report.bearCase} />
          </div>
        )}

        {(activeTab === "scenarios" || isPrinting) && (
          <div className={cn(isPrinting ? "break-before-page pt-10" : "space-y-12")}>
            {isPrinting && <h2 className="text-3xl font-serif font-medium border-b-[1.5px] border-black/20 pb-4 mb-10 text-black">Scenario Framework</h2>}
            {scenarios.length === 0 ? (
              <EmptyState message="No scenario data available for this report." />
            ) : (
              <div className="space-y-12">
                {scenarios.map((scenario, idx) => (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: idx * 0.1, duration: 0.4 }}
                    key={idx}
                    className={cn(
                      "relative rounded-2xl p-8 md:p-12 overflow-hidden",
                      isPrinting ? "border border-black/20 bg-transparent break-inside-avoid" : "border border-border/40 bg-background/60 shadow-[0_2px_20px_rgba(0,0,0,0.02)] group hover:border-border transition-colors backdrop-blur-md"
                    )}
                  >
                    {!isPrinting && (
                      <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                        <Layers className="w-32 h-32" />
                      </div>
                    )}
                    <h3 className={cn("text-2xl md:text-3xl font-serif tracking-tight mb-10 relative z-10", isPrinting && "text-black")}>
                      {scenario.label}
                    </h3>

                    <div className="grid md:grid-cols-[1fr_auto_1fr] gap-8 xl:gap-12 relative z-10">
                      <div>
                        <div className="flex items-center gap-2 mb-6">
                          <div className={cn("w-1.5 h-1.5 rounded-full", isPrinting ? "bg-black/50" : "bg-foreground/30")} />
                          <h4 className={cn("text-[10px] font-mono uppercase tracking-[0.2em] font-semibold", isPrinting ? "text-black/60" : "text-muted-foreground")}>Assumptions</h4>
                        </div>
                        <ul className="space-y-5">
                          {(scenario.assumptions ?? []).map((asc, i) => (
                            <li key={i} className={cn("leading-relaxed text-sm lg:text-[0.95rem] border-l-[1.5px] pl-4 py-0.5", isPrinting ? "text-black/90 border-black/20" : "text-foreground/80 border-border/30")}>
                              {asc}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className={cn("hidden md:block w-px", isPrinting ? "bg-black/10" : "bg-gradient-to-b from-border/0 via-border/40 to-border/0")} />
                      <div className="mt-4 md:mt-0">
                        <div className="flex items-center gap-2 mb-6">
                          <div className={cn("w-1.5 h-1.5 rounded-full", isPrinting ? "bg-black/50" : "bg-foreground/30")} />
                          <h4 className={cn("text-[10px] font-mono uppercase tracking-[0.2em] font-semibold", isPrinting ? "text-black/60" : "text-muted-foreground")}>Implications</h4>
                        </div>
                        <ul className="space-y-5">
                          {(scenario.implications ?? []).map((imp, i) => (
                            <li key={i} className={cn("leading-relaxed text-sm lg:text-[0.95rem] border-l-[1.5px] pl-4 py-0.5", isPrinting ? "text-black/90 border-black/20" : "text-foreground/80 border-border/30")}>
                              {imp}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        )}

        {(activeTab === "sources" || isPrinting) && (
          <div className={cn(isPrinting && "break-before-page pt-10")}>
            {isPrinting && <h2 className="text-3xl font-serif font-medium border-b-[1.5px] border-black/20 pb-4 mb-10 text-black">Bibliographic Record</h2>}
            {!isPrinting && (
              <div className="mb-12">
                <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground mb-4 font-semibold">Bibliographic Record</h3>
                <p className="font-serif text-lg md:text-xl text-foreground/80 max-w-2xl leading-relaxed">
                  The following sources were analyzed to compile this report. They have been verified and processed by the DeepTick intelligence engine.
                </p>
              </div>
            )}
            {sources.length === 0 ? (
              <EmptyState message="No source records available." />
            ) : (
              <div className="space-y-4">
                {sources.map((source, index) => (
                  <SourceCard key={index} source={source} index={index} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="h-full flex flex-col bg-background/50 selection:bg-foreground/10 relative print:bg-white print:h-auto"
    >
      {/* Decorative vertical line in the background */}
      {!isPrinting && <div className="absolute left-1/4 top-0 bottom-0 w-px bg-border/20 pointer-events-none hidden lg:block z-0 print:hidden" />}

      {/* Header section with a subtle backdrop blur */}
      <div className="flex-none px-6 py-4 md:px-12 md:py-6 border-b border-border/40 backdrop-blur-xl bg-background/80 sticky top-0 z-50 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-6 w-full max-w-[1200px] mx-auto">
          {onBack && (
            <button
              onClick={onBack}
              className="group flex items-center justify-center w-10 h-10 rounded-full border border-border/50 hover:border-foreground hover:bg-foreground hover:text-background transition-all shrink-0"
            >
              <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
            </button>
          )}
          <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-6 justify-between w-full">
            <div>
              <motion.h2
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-2xl md:text-3xl font-serif tracking-tight text-foreground font-medium line-clamp-1"
              >
                {job.query}
              </motion.h2>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.1 }}
                className="flex items-center gap-3 mt-1.5 text-[10px] md:text-xs font-mono uppercase tracking-[0.15em] text-muted-foreground"
              >
                <span>{formatDate(job.createdAt)}</span>
                <span className="w-1 h-1 rounded-full bg-border" />
                <span>ID: {job.id.substring(0, 8)}</span>
              </motion.div>
            </div>

            <div className="hidden md:flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                className="gap-2 rounded-full font-mono text-[10px] uppercase tracking-widest px-6"
              >
                <Download className="w-3 h-3" />
                Export JSON
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleGeneratePDF}
                disabled={isPrinting}
                className="gap-2 rounded-full font-mono text-[10px] uppercase tracking-widest px-6 bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50"
              >
                <Printer className="w-3 h-3" />
                {isPrinting ? "Generating..." : "Generate PDF"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col md:flex-row max-w-[1400px] mx-auto w-full relative z-10 print:max-w-none print:flex-col print:overflow-visible print:h-auto">
        {/* Desktop Sidebar Navigation */}
        <div className="hidden md:flex flex-col w-64 lg:w-72 border-r border-border/30 bg-background/50 p-6 space-y-2 shrink-0 h-full overflow-y-auto hide-scrollbar print:hidden">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground mb-6 pl-3">
            Contents
          </div>
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-all relative outline-none",
                  isActive ? "text-foreground font-medium bg-muted/40 shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted/20"
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="sidebar-indicator"
                    className="absolute left-0 top-1/4 bottom-1/4 w-[3px] bg-foreground rounded-r-full"
                  />
                )}
                <Icon className="w-4 h-4 opacity-70" />
                {tab.label}
              </button>
            );
          })}

          <Separator className="my-6 opacity-30" />

          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground mb-4 pl-3">
            Audit Status
          </div>

          {report.auditReport && (
            <div className={cn("rounded-xl p-4 border", auditStatus.border, auditStatus.bg)}>
              <div className="flex items-center gap-2 mb-2">
                <AuditIcon className={cn("w-4 h-4 shrink-0", auditStatus.color)} />
                <span className={cn("text-[11px] font-bold uppercase tracking-wider", auditStatus.color)}>
                  {auditStatus.label}
                </span>
              </div>
              <div className="text-xs text-muted-foreground/80 leading-relaxed font-serif">
                {report.auditReport.checkedClaims ?? 0} claims successfully validated against canonical sources.
              </div>
            </div>
          )}
        </div>

        {/* Mobile Navigation */}
        <div className="md:hidden flex overflow-x-auto p-4 border-b border-border/40 gap-2 hide-scrollbar shrink-0 bg-background print:hidden">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "whitespace-nowrap px-4 py-2 rounded-full text-xs font-medium transition-all shadow-sm border",
                activeTab === tab.id
                  ? "bg-foreground text-background border-foreground"
                  : "bg-background text-muted-foreground border-border/60 hover:bg-muted/50"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {isPrinting ? (
          <div className="flex-1 w-full bg-white text-black p-8 md:p-16 max-w-4xl mx-auto print:p-0 print:max-w-none">
            <div className="mb-14 border-b-[3px] border-black pb-8 break-inside-avoid">
              <div className="flex items-center gap-4 mb-8">
                <Activity className="w-10 h-10 text-black" />
                <h1 className="text-xl md:text-2xl font-mono uppercase tracking-[0.3em] font-bold text-black border-l-2 border-black pl-4">DeepTick Intelligence</h1>
              </div>
              <h2 className="text-4xl md:text-5xl font-serif tracking-tight font-medium mb-6 text-black">{job.query}</h2>
              <div className="flex gap-6 font-mono text-[10px] uppercase tracking-[0.2em] text-black/60 font-semibold">
                <span>{formatDate(job.createdAt)}</span>
                <span>REF: {job.id.substring(0, 8)}</span>
              </div>
            </div>
            {renderSections()}
          </div>
        ) : (
          <ScrollArea className="flex-1 bg-surface/10 w-full relative">
            <div className="px-6 py-10 md:py-16 lg:px-12 xl:px-24 max-w-[100ch] mx-auto min-h-full">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                >
                  {renderSections()}
                </motion.div>
              </AnimatePresence>

              {/* Footer padding */}
              <div className="h-32"></div>
            </div>
          </ScrollArea>
        )}
      </div>
    </motion.div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-6 border border-dashed border-border/60 rounded-xl bg-surface/30">
      <Activity className="w-8 h-8 text-muted-foreground/30 mb-4" />
      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60">{message}</p>
    </div>
  )
}

function MarkdownSection({ title, content }: { title: string; content: string }) {
  if (!content) return null;
  return (
    <div className="flex flex-col gap-6 lg:gap-8 relative group mb-16 last:mb-0 break-inside-avoid table-auto">
      <div className="flex items-center gap-4">
        <div className="w-8 h-px bg-foreground/20 print:bg-black/20" />
        <h3 className="text-[11px] font-mono uppercase tracking-[0.25em] text-muted-foreground print:text-black/60 font-semibold">
          {title}
        </h3>
      </div>
      <div className="pl-0 lg:pl-12">
        <div className="prose dark:prose-invert max-w-none
          /* Paragraph typography */
          prose-p:font-serif prose-p:text-[1.05rem] md:prose-p:text-[1.125rem] prose-p:leading-[1.9] prose-p:text-foreground/85 print:prose-p:text-black/90 prose-p:tracking-[-0.01em] prose-p:mb-5
          
          /* Headings typography */
          prose-headings:font-serif prose-headings:font-medium prose-headings:tracking-tight prose-headings:text-foreground print:prose-headings:text-black prose-headings:mt-12 prose-headings:mb-6
          prose-h1:text-3xl prose-h1:font-normal
          prose-h2:text-2xl prose-h2:border-b prose-h2:border-border/40 print:prose-h2:border-black/20 prose-h2:pb-4 prose-h2:mt-14
          prose-h3:text-[1.35rem] prose-h3:text-foreground/90 print:prose-h3:text-black/90
          prose-h4:font-mono prose-h4:text-[11px] prose-h4:uppercase prose-h4:tracking-[0.2em] prose-h4:text-muted-foreground print:prose-h4:text-black/60 prose-h4:font-semibold prose-h4:mt-8
          
          /* Lists styling */
          prose-ul:list-none prose-ul:pl-0 prose-ul:space-y-3 prose-ul:my-6
          prose-li:relative prose-li:pl-6 prose-li:font-serif prose-li:text-[1.05rem] md:prose-li:text-[1.125rem] prose-li:leading-[1.9] prose-li:text-foreground/85 print:prose-li:text-black/90
          prose-li:before:content-[''] prose-li:before:absolute prose-li:before:left-[0.35rem] md:prose-li:before:left-1.5 prose-li:before:top-[0.7em] prose-li:before:w-1.5 prose-li:before:h-1.5 prose-li:before:rounded-full prose-li:before:bg-foreground/30 print:prose-li:before:bg-black/30
          
          /* Table styling */
          prose-table:w-full prose-table:my-10 prose-table:text-left prose-table:border-collapse prose-table:text-[0.95rem] md:prose-table:text-[1.05rem] prose-table:border-y prose-table:border-border/60 print:prose-table:border-black/20 print:prose-table:text-black/90
          prose-thead:bg-surface/40 print:prose-thead:bg-transparent prose-thead:border-b-[1.5px] prose-thead:border-border/60 print:prose-thead:border-black/20
          prose-th:px-5 prose-th:py-4 prose-th:font-sans prose-th:font-semibold prose-th:text-foreground print:prose-th:text-black prose-th:align-bottom prose-th:whitespace-nowrap
          prose-td:border-b prose-td:border-border/30 print:prose-td:border-black/10 prose-td:px-5 prose-td:py-4 prose-td:font-serif prose-td:text-foreground/80 print:prose-td:text-black/80 prose-td:align-top
          prose-tr:last:border-b-0 prose-tr:hover:bg-muted/10 print:prose-tr:hover:bg-transparent prose-tr:transition-colors
          
          /* Blockquotes & other elements */
          prose-blockquote:border-l-[2px] prose-blockquote:border-foreground/30 print:prose-blockquote:border-black/30 prose-blockquote:font-serif prose-blockquote:italic prose-blockquote:text-foreground/70 print:prose-blockquote:text-black/70 prose-blockquote:pl-6 prose-blockquote:py-2 prose-blockquote:my-8 prose-blockquote:bg-surface/30 print:prose-blockquote:bg-transparent print:prose-blockquote:pl-4 prose-blockquote:pr-6
          prose-strong:font-semibold prose-strong:text-foreground print:prose-strong:text-black
          prose-a:text-foreground print:prose-a:text-black prose-a:underline prose-a:decoration-border/60 print:prose-a:decoration-black/20 hover:prose-a:decoration-foreground prose-a:underline-offset-4
          prose-hr:border-border/40 print:prose-hr:border-black/20 prose-hr:my-10
          ">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

function SourceCard({ source, index }: { source: ResearchSource; index: number }) {
  const hostname = (() => {
    try { return new URL(source.url).hostname; } catch { return source.url; }
  })();

  return (
    <Collapsible>
      <div className="group rounded-xl border border-border/40 bg-background/50 hover:bg-background transition-all hover:shadow-[0_2px_15px_rgba(0,0,0,0.02)] overflow-hidden print:border-black/20 print:bg-transparent print:shadow-none print:mb-4">
        <CollapsibleTrigger className="w-full text-left px-6 py-5 flex items-start sm:items-center gap-5 outline-none print:py-4">
          <div className="text-[10px] font-mono text-muted-foreground/60 w-6 shrink-0 pt-1 sm:pt-0 print:text-black/50">
            {String(index + 1).padStart(2, '0')}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-serif text-[1rem] md:text-lg truncate group-hover:text-foreground transition-colors pr-4 print:text-black print:whitespace-normal">
              {source.title}
            </h4>
            <div className="flex items-center gap-3 mt-1.5 opacity-80 group-hover:opacity-100 transition-opacity print:opacity-100">
              <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground/80 print:text-black/60">
                {source.domain || hostname}
              </span>
              {source.relevanceScore && (
                <>
                  <span className="w-1 h-1 rounded-full bg-border/50 print:bg-black/20" />
                  <span className={cn(
                    "text-[9px] font-mono uppercase tracking-[0.2em]",
                    source.relevanceScore > 0.8 ? "text-emerald-600 dark:text-emerald-400 print:text-emerald-700" : "text-muted-foreground print:text-black/60"
                  )}>
                    {source.relevanceScore > 0.8 ? 'High Rel' : 'Med Rel'}
                  </span>
                </>
              )}
            </div>
          </div>
          <ChevronDown className="w-4 h-4 text-muted-foreground/40 transition-transform duration-300 group-data-[state=open]:rotate-180 shrink-0 print:hidden" />
        </CollapsibleTrigger>
        <CollapsibleContent className="print:block">
          <div className="px-6 pb-6 pt-2 print:pb-4">
            <div className="pl-11">
              {source.snippet && (
                <div className="relative mb-6 print:mb-4">
                  <div className="absolute -left-4 top-1 bottom-1 w-[1.5px] bg-border/40 print:bg-black/20" />
                  <p className="font-serif text-[0.95rem] md:text-base leading-relaxed text-foreground/70 italic print:text-black/80">
                    "{source.snippet}"
                  </p>
                </div>
              )}
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.15em] hover:text-foreground transition-all px-5 py-2.5 rounded-full border border-border/50 hover:bg-muted/50 text-muted-foreground print:hidden"
              >
                <ExternalLink className="w-3 h-3" />
                Access Source Material
              </a>
              <p className="hidden print:block font-mono text-[9px] text-black/40 break-all w-full">
                URI: {source.url}
              </p>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
