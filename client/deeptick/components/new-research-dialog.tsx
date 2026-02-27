"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Loader2, TrendingUp, Building2, DollarSign, Globe, Cloud, Cpu, Zap, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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

  useEffect(() => {
    if (!open) {
      setQuery("");
      setContext("");
      setFocusAreas([]);
      setShowAdvanced(false);
    }
  }, [open]);

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
      <DialogContent className="sm:max-w-2xl rounded-none border border-border bg-card shadow-none pt-8">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-2xl font-serif text-foreground tracking-tight">
            {isGradient ? (
              <>
                <Cloud className="h-6 w-6 text-cyan-600 dark:text-cyan-400" />
                <span>INITIALIZE GRADIENT QUERY</span>
              </>
            ) : (
              <>
                <Cpu className="h-6 w-6 text-foreground" />
                <span>INITIALIZE QUERY</span>
              </>
            )}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-2 border-b border-border pb-4">
            {isGradient ? (
              <span className="flex items-center gap-1.5">
                <Zap className="h-3 w-3 text-cyan-600 dark:text-cyan-400" />
                SYSTEM: GRADIENT AI PLATFORM [ KNOWLEDGE BASES ACTIVE ]
              </span>
            ) : (
              <span>SYSTEM: OPEN SOURCE MODELS [ INSTITUTIONAL ANALYSIS ]</span>
            )}
          </DialogDescription>
        </DialogHeader>

        {isGradient && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="flex items-center gap-3 p-3 bg-cyan-500/10 border-l-2 border-cyan-500"
          >
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-cyan-700 dark:text-cyan-400" />
              <span className="font-mono text-[10px] uppercase tracking-widest text-cyan-800 dark:text-cyan-300 font-bold">
                NATIVE FEATURES LOADED
              </span>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-[9px] uppercase tracking-widest rounded-none border-cyan-500/30 text-cyan-800 dark:text-cyan-300 bg-transparent">
                AGENTS
              </Badge>
              <Badge variant="outline" className="font-mono text-[9px] uppercase tracking-widest rounded-none border-cyan-500/30 text-cyan-800 dark:text-cyan-300 bg-transparent">
                KNOWLEDGE BASE
              </Badge>
              <Badge variant="outline" className="font-mono text-[9px] uppercase tracking-widest rounded-none border-cyan-500/30 text-cyan-800 dark:text-cyan-300 bg-transparent">
                RAG
              </Badge>
            </div>
          </motion.div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6 mt-4">
          <div className="space-y-3">
            <label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">QUICK DOSSIER TEMPLATES</label>
            <div className="grid grid-cols-2 gap-3">
              {quickPrompts.map((prompt, index) => (
                <motion.button
                  key={index}
                  type="button"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  onClick={() => setQuery(prompt.label)}
                  className={cn(
                    "flex items-center gap-3 p-3 text-xs font-mono tracking-wide text-left border border-border bg-card transition-colors rounded-none shadow-none",
                    "hover:bg-muted/50 hover:border-primary/50",
                    query === prompt.label && "border-primary bg-muted/80 text-foreground"
                  )}
                >
                  <prompt.icon className="h-4 w-4 text-foreground shrink-0" />
                  <span className="truncate">{prompt.label}</span>
                </motion.button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <label htmlFor="query" className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <span>PRIMARY DIRECTIVE / QUERY</span>
              <div className="h-px bg-border flex-1" />
            </label>
            <Textarea
              id="query"
              placeholder="ENTER ANALYSIS PARAMETERS..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="min-h-[120px] resize-none rounded-none font-serif text-lg leading-relaxed placeholder:font-mono placeholder:text-xs placeholder:uppercase tracking-wide focus-visible:ring-1 focus-visible:ring-primary border-border bg-background"
            />
          </div>

          <div className="space-y-4">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2"
            >
              <span>{showAdvanced ? "[-] HIDE" : "[+] SHOW"} ADVANCED PARAMETERS</span>
            </button>

            <AnimatePresence>
              {showAdvanced && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="space-y-4 overflow-hidden"
                >
                  <div className="space-y-3 pt-2">
                    <label htmlFor="context" className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      SUPPLEMENTARY CONTEXT
                    </label>
                    <Textarea
                      id="context"
                      placeholder="APPEND ADDITIONAL METADATA OR CONTEXT..."
                      value={context}
                      onChange={(e) => setContext(e.target.value)}
                      className="min-h-[80px] resize-none rounded-none font-serif text-sm placeholder:font-mono placeholder:text-xs placeholder:uppercase border-border bg-background"
                    />
                  </div>

                  <div className="space-y-3 pt-2">
                    <label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">FOCUS VECTORS</label>
                    <div className="flex flex-wrap gap-2">
                      {["Financial Analysis", "Competitive Landscape", "Market Trends", "Risk Assessment", "Valuation"].map(
                        (area) => (
                          <button
                            key={area}
                            type="button"
                            onClick={() => toggleFocusArea(area)}
                            className={cn(
                              "px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest border transition-colors rounded-none",
                              focusAreas.includes(area)
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-card hover:bg-muted/50 hover:border-primary/50 text-muted-foreground"
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

          <div className="flex items-center justify-between pt-6 mt-6 border-t border-border">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
              className="rounded-none font-mono text-xs uppercase tracking-widest border-border"
            >
              ABORT
            </Button>
            <Button
              type="submit"
              disabled={!query.trim() || isLoading}
              className="gap-2 rounded-none font-mono text-xs uppercase tracking-widest bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground px-8"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  INITIALIZING...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  EXECUTE
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
