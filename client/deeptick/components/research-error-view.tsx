"use client";

import { motion } from "framer-motion";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ResearchJob } from "@/lib/types";

interface ResearchErrorViewProps {
  job: ResearchJob;
  onBack?: () => void;
}

export function ResearchErrorView({ job, onBack }: ResearchErrorViewProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -12 }}
      transition={{ duration: 0.2 }}
      className="h-full flex flex-col"
    >
      <div className="flex items-center gap-4 p-6 border-b border-border/50">
        {onBack && (
          <Button variant="outline" size="icon" onClick={onBack} className="rounded-none h-10 w-10 shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-widest text-red-700 dark:text-red-400">Research Failed</p>
          <h2 className="text-2xl font-serif truncate">{job.query}</h2>
        </div>
      </div>

      <div className="p-6">
        <div className="border border-red-500/30 bg-red-500/10 p-4 rounded-none">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-red-700 dark:text-red-400 mb-2">Error Details</p>
              <p className="font-mono text-sm leading-relaxed break-words">
                {job.error ?? "No error details were provided by the server."}
              </p>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
