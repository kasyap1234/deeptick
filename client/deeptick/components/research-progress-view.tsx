"use client";

import { motion } from "framer-motion";
import { ArrowLeft, CircleDashed, Globe, Network, Brain, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import type { ProgressUpdate, ResearchJob } from "@/lib/types";

interface ResearchProgressViewProps {
  job: ResearchJob;
  progress?: ProgressUpdate;
  onBack?: () => void;
}

const STAGES = [
  "queued",
  "planning",
  "delegating",
  "reconciling",
  "auditing",
  "finalizing",
  "completed",
] as const;

const stageLabel: Record<string, string> = {
  queued: "Queued",
  planning: "Planning",
  delegating: "Searching",
  reconciling: "Analyzing",
  auditing: "Auditing",
  finalizing: "Finalizing",
  completed: "Completed",
  failed: "Failed",
};

// Stage boundaries for smooth progress interpolation
const STAGE_RANGE: Record<string, [number, number]> = {
  queued: [0, 8],
  planning: [8, 20],
  delegating: [20, 72],   // largest range — sub-agent work happens here
  reconciling: [72, 82],
  auditing: [82, 92],
  finalizing: [92, 98],
  completed: [100, 100],
  failed: [100, 100],
};

function getStageProgress(
  stage: string,
  completedSubagents?: number,
  expectedSubagents?: number,
): number {
  const range = STAGE_RANGE[stage];
  if (!range) return 5;

  const [min, max] = range;

  // For the delegating stage, interpolate based on sub-agent completion
  if (stage === 'delegating' && expectedSubagents && expectedSubagents > 0) {
    const completed = completedSubagents ?? 0;
    const ratio = Math.min(completed / expectedSubagents, 1);
    return Math.round(min + ratio * (max - min));
  }

  // For other stages, just return the midpoint
  return Math.round((min + max) / 2);
}

export function ResearchProgressView({ job, progress, onBack }: ResearchProgressViewProps) {
  const stage = progress?.stage ?? (job.status === "pending" ? "queued" : "planning");
  const urls = progress?.urls ?? [];
  const reasoning = progress?.reasoning ?? [];
  const activities = progress?.subAgentActivities ?? [];
  const sourceCount = progress?.uniqueSources ?? urls.length;
  const completedSubagents = progress?.completedSubagents ?? activities.filter(a => a.status === "completed").length;
  const expectedSubagents = progress?.expectedSubagents ?? 7;
  const progressValue = stage === "failed" ? 100 : getStageProgress(stage, completedSubagents, expectedSubagents);

  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -12 }}
      transition={{ duration: 0.2 }}
      className="h-full flex flex-col"
    >
      <div className="flex items-center justify-between p-6 border-b border-border/50">
        <div className="flex items-center gap-4 min-w-0">
          {onBack && (
            <Button variant="outline" size="icon" onClick={onBack} className="rounded-none h-10 w-10 shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Live Research Progress</p>
            <h2 className="text-2xl font-serif truncate">{job.query}</h2>
          </div>
        </div>
        <div className="flex items-center gap-2 border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 rounded-none">
          <CircleDashed className="h-3.5 w-3.5 text-cyan-500 animate-spin" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-cyan-700 dark:text-cyan-400">
            {stageLabel[stage] ?? stage}
          </span>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-6 space-y-4">
          <Card className="rounded-none border border-border">
            <CardHeader className="pb-3">
              <CardTitle className="font-mono text-xs uppercase tracking-widest">Stage Progress</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Progress value={progressValue} max={100} className="h-2 rounded-none" />
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                <span>{stageLabel[stage] ?? stage}</span>
                <span>{progressValue}%</span>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-none border border-border">
            <CardHeader className="pb-3">
              <CardTitle className="font-mono text-xs uppercase tracking-widest flex items-center gap-2">
                <FileText className="h-3.5 w-3.5" /> Source Count
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-serif leading-none">{sourceCount}</p>
            </CardContent>
          </Card>

          <Card className="rounded-none border border-border">
            <CardHeader className="pb-3">
              <CardTitle className="font-mono text-xs uppercase tracking-widest flex items-center gap-2">
                <Globe className="h-3.5 w-3.5" /> URLs Visited
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {urls.length === 0 ? (
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Waiting for first source...</p>
              ) : (
                urls.slice(-12).reverse().map((url, index) => (
                  <div key={`${url}-${index}`} className="font-mono text-[10px] leading-relaxed border-l-2 border-border pl-2 break-all">
                    {url}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="rounded-none border border-border">
            <CardHeader className="pb-3">
              <CardTitle className="font-mono text-xs uppercase tracking-widest flex items-center gap-2">
                <Brain className="h-3.5 w-3.5" /> AI Reasoning
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {reasoning.length === 0 ? (
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">No reasoning emitted yet...</p>
              ) : (
                reasoning.slice(-10).reverse().map((note, index) => (
                  <div key={`${note}-${index}`} className="font-mono text-[10px] leading-relaxed border-l-2 border-border pl-2">
                    {note}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="rounded-none border border-border">
            <CardHeader className="pb-3">
              <CardTitle className="font-mono text-xs uppercase tracking-widest flex items-center gap-2">
                <Network className="h-3.5 w-3.5" /> Sub-Agent Activity
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {activities.length === 0 ? (
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Sub-agent activity pending...</p>
              ) : (
                activities.slice(-10).reverse().map((activity) => (
                  <div key={activity.id} className="flex items-start gap-2 border-l-2 border-border pl-2">
                    <span className="mt-1 h-2 w-2 rounded-full bg-cyan-500 animate-pulse" />
                    <div className="min-w-0">
                      <p className="font-mono text-[10px] uppercase tracking-widest">{activity.name} [{activity.status}]</p>
                      {activity.detail && (
                        <p className="font-mono text-[10px] text-muted-foreground leading-relaxed break-words">{activity.detail}</p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </motion.div>
  );
}
