"use client";

import { motion } from "framer-motion";
import { Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isGradientEnabled } from "@/lib/api";

export function EmptyState({ onStartResearch }: { onStartResearch: () => void }) {
  const isGradient = isGradientEnabled;

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center overflow-y-auto relative">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] border-[1px] border-border/20 rounded-full pointer-events-none opacity-20" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] border-[1px] border-border/20 rounded-full pointer-events-none opacity-20" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-2xl border-4 border-double border-foreground p-12 bg-background relative z-10 shadow-[20px_20px_0px_0px_rgba(0,0,0,0.05)] dark:shadow-[20px_20px_0px_0px_rgba(255,255,255,0.02)]"
      >
        <div className="absolute top-4 left-4 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">FORM-8A</div>
        <div className="absolute top-4 right-4 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">REV. 2026</div>

        {isGradient && (
          <div className="absolute -top-3 -right-3 rotate-[15deg]">
            <span className="stamped stamped-primary text-[10px]">GRADIENT ENGINE</span>
          </div>
        )}

        <div className="border-b-2 border-foreground pb-8 mb-8 mt-6">
          <Brain className="h-12 w-12 text-foreground mx-auto mb-6 opacity-80" />
          <h2 className="text-5xl md:text-7xl font-serif text-foreground tracking-tighter uppercase leading-[0.85] mb-6">
            Initialize<br />Dossier
          </h2>
          <p className="font-mono text-[10px] uppercase tracking-widest text-foreground bg-muted p-2 inline-block border border-border">
            {isGradient ? "[ SYS: GRADIENT FRAMEWORK ACTIVE ]" : "[ SYS: OPEN SOURCE INFERENCE ]"}
          </p>
        </div>

        <div className="text-left font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground space-y-4 mb-12">
          <div className="flex justify-between border-b border-border border-dashed pb-1">
            <span>AUTHORIZATION:</span>
            <span className="text-foreground font-bold">GRANTED</span>
          </div>
          <div className="flex justify-between border-b border-border border-dashed pb-1">
            <span>PROVENANCE:</span>
            <span className="text-foreground font-bold">VERIFIABLE (80+ SRC)</span>
          </div>
          <div className="flex justify-between border-b border-border border-dashed pb-1">
            <span>UPLINK:</span>
            <span className={isGradient ? "text-cyan-600 dark:text-cyan-400 font-bold" : "text-emerald-600 dark:text-emerald-400 font-bold"}>
              SECURE / ACTIVE
            </span>
          </div>
        </div>

        <Button
          onClick={onStartResearch}
          className="w-full h-16 rounded-none bg-foreground text-background hover:bg-transparent border-2 border-transparent hover:border-foreground hover:text-foreground transition-all font-mono text-[11px] uppercase tracking-[0.2em] font-bold shadow-[6px_6px_0px_0px_rgba(0,0,0,0.15)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.15)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-none"
        >
          <span className="animate-pulse mr-3">▶</span> COMMENCE ANALYSIS SEQUENCE
        </Button>
      </motion.div>
    </div>
  );
}
