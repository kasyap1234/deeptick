"use client";

import { motion } from "framer-motion";
import { Clock, CheckCircle, AlertCircle, Loader2, FileText, ExternalLink, Cloud, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import type { ResearchJob } from "@/lib/types";

interface ResearchCardProps {
  job: ResearchJob;
  onClick?: () => void;
  isSelected?: boolean;
}

const statusConfig = {
  pending: {
    icon: Clock,
    label: "Pending",
    variant: "secondary" as const,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/20",
  },
  in_progress: {
    icon: Loader2,
    label: "In Progress",
    variant: "default" as const,
    color: "text-cyan-500",
    bgColor: "bg-cyan-500/10",
    borderColor: "border-cyan-500/20",
  },
  completed: {
    icon: CheckCircle,
    label: "Completed",
    variant: "default" as const,
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/20",
  },
  failed: {
    icon: AlertCircle,
    label: "Failed",
    variant: "destructive" as const,
    color: "text-red-500",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/20",
  },
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatDate(dateStr: string) {
  return dateFormatter.format(new Date(dateStr));
}

export function ResearchCard({ job, onClick, isSelected }: ResearchCardProps) {
  const status = statusConfig[job.status];
  const StatusIcon = status.icon;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick?.();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      transition={{ duration: 0.15 }}
    >
      <Card
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={handleKeyDown}
        className={cn(
          "cursor-pointer transition-all duration-75 border border-border bg-card rounded-none hover:bg-muted/50 relative overflow-hidden group",
          isSelected ? "border-l-[12px] border-l-foreground border-y-foreground border-r-foreground bg-background shadow-lg z-10 translate-x-1" : "hover:border-foreground/50"
        )}
      >
        {isSelected && (
          <div className="absolute top-0 right-0 pointer-events-none opacity-[0.03]">
            <span className="font-serif text-[120px] leading-none select-none -translate-y-4 inline-block">
              {job.query.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        <CardContent className="p-5 relative z-10">
          <div className="flex items-start gap-4">
            <div
              className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center border-2 rounded-none",
                isSelected ? "border-foreground bg-foreground text-background" : status.bgColor + " " + status.borderColor
              )}
            >
              <StatusIcon
                className={cn("h-5 w-5", isSelected ? "text-background" : status.color, job.status === "in_progress" && "animate-spin")}
              />
            </div>

            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <h4 className={cn(
                "font-serif text-lg truncate leading-tight mb-2 tracking-tight",
                isSelected ? "text-foreground font-bold" : "text-foreground"
              )}>
                {job.query}
              </h4>

              <div className="flex items-center gap-3 font-mono text-[9px] uppercase tracking-widest text-muted-foreground w-full flex-wrap">
                <span suppressHydrationWarning className={cn("border border-border px-1", isSelected && "border-foreground/30")}>
                  {formatDate(job.createdAt)}
                </span>
                {job.metadata?.sourceMetrics && (
                  <span className="flex items-center gap-1.5 bg-muted/50 px-1 border border-border">
                    <FileText className="h-3 w-3" />
                    {job.metadata.sourceMetrics.uniqueSources} SRC
                  </span>
                )}

                <span className={cn("ml-auto font-bold px-1.5 py-0.5 border border-current",
                  job.status === 'completed' && "text-emerald-600 dark:text-emerald-400",
                  job.status === 'in_progress' && "text-cyan-600 dark:text-cyan-400",
                  job.status === 'pending' && "text-amber-500",
                  job.status === 'failed' && "text-red-600 dark:text-red-400"
                )}>
                  [{status.label}]
                </span>
              </div>
            </div>
          </div>

          {job.metadata?.duration && (
            <div className="mt-3 pt-3 border-t border-border flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <span>ELAPSED: {Math.round(job.metadata.duration / 1000)}s</span>
              {job.result && (
                <span className="flex items-center gap-1 text-primary hover:text-primary/80 transition-colors cursor-pointer">
                  VIEW DOSSIER <ExternalLink className="h-3 w-3" />
                </span>
              )}
            </div>
          )}

          {job.metadata?.useGradientNative && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mt-3 flex items-center gap-2"
            >
              <div className="flex items-center gap-1.5 px-2 py-1 bg-cyan-500/10 border-l-2 border-cyan-500">
                <Cloud className="h-3 w-3 text-cyan-500" />
                <span className="font-mono text-[9px] uppercase tracking-widest text-cyan-700 dark:text-cyan-400">
                  GRADIENT AI
                </span>
              </div>
              {job.metadata?.gradientKnowledgeBaseId && (
                <div className="flex items-center gap-1.5 px-2 py-1 bg-violet-500/10 border-l-2 border-violet-500">
                  <Cpu className="h-3 w-3 text-violet-500" />
                  <span className="font-mono text-[9px] uppercase tracking-widest text-violet-700 dark:text-violet-400">
                    KB ACTIVE
                  </span>
                </div>
              )}
            </motion.div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
