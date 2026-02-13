"use client";

import { motion } from "framer-motion";
import { Clock, CheckCircle, AlertCircle, Loader2, FileText, ExternalLink, Cloud, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

export function ResearchCard({ job, onClick, isSelected }: ResearchCardProps) {
  const status = statusConfig[job.status];
  const StatusIcon = status.icon;

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
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
        onClick={onClick}
        className={cn(
          "cursor-pointer transition-all duration-200 gradient-card border-border/50 hover:border-primary/30 hover:shadow-md",
          isSelected && "border-primary/40 ring-1 ring-primary/20 glow-primary-sm"
        )}
      >
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border",
                status.bgColor,
                status.borderColor
              )}
            >
              <StatusIcon
                className={cn("h-5 w-5", status.color, job.status === "in_progress" && "animate-spin")}
              />
            </div>

            <div className="flex-1 min-w-0">
              <h4 className="font-medium text-sm truncate leading-tight mb-1">
                {job.query}
              </h4>

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{formatDate(job.createdAt)}</span>
                {job.metadata?.sourceMetrics && (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <FileText className="h-3 w-3" />
                      {job.metadata.sourceMetrics.uniqueSources} sources
                    </span>
                  </>
                )}
              </div>
            </div>

            <Badge
              variant={status.variant}
              className={cn("text-xs shrink-0", status.bgColor, status.color)}
            >
              {status.label}
            </Badge>
          </div>

          {job.metadata?.duration && (
            <div className="mt-3 pt-3 border-t border-border/30 flex items-center justify-between text-xs text-muted-foreground">
              <span>Duration: {Math.round(job.metadata.duration / 1000)}s</span>
              {job.result && (
                <span className="flex items-center gap-1 text-primary hover:text-primary/80 transition-colors">
                  View Report <ExternalLink className="h-3 w-3" />
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
              <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20">
                <Cloud className="h-3 w-3 text-cyan-500" />
                <span className="text-[10px] font-medium text-cyan-600 dark:text-cyan-400">
                  Gradient AI
                </span>
              </div>
              {job.metadata?.gradientKnowledgeBaseId && (
                <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-gradient-to-r from-violet-500/10 to-purple-500/10 border border-violet-500/20">
                  <Cpu className="h-3 w-3 text-violet-500" />
                  <span className="text-[10px] font-medium text-violet-600 dark:text-violet-400">
                    KB Active
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
