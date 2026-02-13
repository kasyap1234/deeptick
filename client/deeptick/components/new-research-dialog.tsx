"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, Loader2, TrendingUp, Building2, DollarSign, Globe, Cloud, Cpu, Zap, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useGradient } from "@/lib/api";

interface NewResearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (query: string, context?: string, focusAreas?: string[]) => void;
  isLoading?: boolean;
}

const quickPrompts = [
  { icon: TrendingUp, label: "Tesla (TSLA) investment analysis" },
  { icon: Building2, label: "NVIDIA competitive position 2025" },
  { icon: DollarSign, label: "Bitcoin ETF market impact" },
  { icon: Globe, label: "Apple services business growth" },
];

export function NewResearchDialog({
  open,
  onOpenChange,
  onSubmit,
  isLoading,
}: NewResearchDialogProps) {
  const [query, setQuery] = useState("");
  const [context, setContext] = useState("");
  const [focusAreas, setFocusAreas] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const isGradient = useGradient;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    onSubmit(query, context || undefined, focusAreas.length > 0 ? focusAreas : undefined);
  };

  const toggleFocusArea = (area: string) => {
    setFocusAreas((prev) =>
      prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area]
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl gradient-card border-border/50">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            {isGradient ? (
              <>
                <Cloud className="h-5 w-5 text-cyan-500" />
                <span>Gradient AI Research</span>
              </>
            ) : (
              <>
                <Cpu className="h-5 w-5 text-violet-500" />
                <span>Research Query</span>
              </>
            )}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            {isGradient ? (
              <span className="flex items-center gap-1.5">
                <Zap className="h-3 w-3 text-cyan-500" />
                Powered by Gradient AI Platform with Knowledge Bases
              </span>
            ) : (
              <span>Ask any investment research question using open source models.</span>
            )}
          </DialogDescription>
        </DialogHeader>

        {isGradient && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="flex items-center gap-2 p-3 rounded-lg bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20"
          >
            <div className="flex items-center gap-1.5">
              <Database className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
              <span className="text-xs font-medium text-cyan-700 dark:text-cyan-300">
                Native Features
              </span>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-1">
              <Badge variant="outline" className="text-[10px] h-5 bg-cyan-500/10 border-cyan-500/30 text-cyan-700 dark:text-cyan-300">
                Gradient Agents
              </Badge>
              <Badge variant="outline" className="text-[10px] h-5 bg-cyan-500/10 border-cyan-500/30 text-cyan-700 dark:text-cyan-300">
                Knowledge Base
              </Badge>
              <Badge variant="outline" className="text-[10px] h-5 bg-cyan-500/10 border-cyan-500/30 text-cyan-700 dark:text-cyan-300">
                RAG
              </Badge>
            </div>
          </motion.div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6 mt-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Quick Prompts</label>
            <div className="grid grid-cols-2 gap-2">
              {quickPrompts.map((prompt, index) => (
                <motion.button
                  key={index}
                  type="button"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  onClick={() => setQuery(prompt.label)}
                  className={cn(
                    "flex items-center gap-2 p-3 text-sm text-left rounded-lg border border-border/50",
                    "hover:border-primary/50 hover:bg-primary/5 transition-colors",
                    query === prompt.label && "border-primary bg-primary/10"
                  )}
                >
                  <prompt.icon className="h-4 w-4 text-primary shrink-0" />
                  <span className="truncate">{prompt.label}</span>
                </motion.button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="query" className="text-sm font-medium">
              Research Question
            </label>
            <Textarea
              id="query"
              placeholder="e.g., Analyze Tesla's investment prospects for 2025, considering EV market growth and competition..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="min-h-[100px] resize-none"
            />
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {showAdvanced ? "Hide" : "Show"} Advanced Options
            </button>

            <AnimatePresence>
              {showAdvanced && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="space-y-4 overflow-hidden"
                >
                  <div className="space-y-2">
                    <label htmlFor="context" className="text-sm font-medium">
                      Additional Context (Optional)
                    </label>
                    <Textarea
                      id="context"
                      placeholder="Any specific context or background information..."
                      value={context}
                      onChange={(e) => setContext(e.target.value)}
                      className="min-h-[80px] resize-none"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Focus Areas</label>
                    <div className="flex flex-wrap gap-2">
                      {["Financial Analysis", "Competitive Landscape", "Market Trends", "Risk Assessment", "Valuation"].map(
                        (area) => (
                          <button
                            key={area}
                            type="button"
                            onClick={() => toggleFocusArea(area)}
                            className={cn(
                              "px-3 py-1.5 text-xs rounded-full border transition-colors",
                              focusAreas.includes(area)
                                ? "border-primary bg-primary/20 text-primary"
                                : "border-border/50 hover:border-primary/50"
                            )}
                          >
                            {area}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border/50">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!query.trim() || isLoading}
              className="gap-2 bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Starting Research...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Start Research
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
