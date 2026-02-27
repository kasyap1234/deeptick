"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { 
  Cloud, 
  Cpu, 
  Zap, 
  CheckCircle2, 
  AlertCircle,
  Loader2 
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGradient } from "@/lib/api";

interface GradientToggleProps {
  className?: string;
}

export function GradientToggle({ className }: GradientToggleProps) {
  const isGradient = useGradient;
  const [status, setStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const [gradientAgents, setGradientAgents] = useState(0);

  useEffect(() => {
    if (isGradient) {
      checkGradientStatus();
    }
  }, [isGradient]);

  const checkGradientStatus = async () => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/gradient/agents`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setGradientAgents(data.data?.length || 0);
        setStatus('connected');
        return;
      }
      if (response.status === 503) {
        const data = await response.json().catch(() => ({}));
        const msg = String(data?.error ?? '');
        if (msg.includes('not configured') || msg.includes('required')) {
          setGradientAgents(0);
          setStatus('connected');
          return;
        }
      }
      setStatus('error');
    } catch {
      setStatus('error');
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex items-center gap-3 p-3 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm", className)}
    >
      <div className={cn(
        "flex h-10 w-10 items-center justify-center rounded-lg transition-all duration-300",
        isGradient 
          ? "bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/30" 
          : "bg-gradient-to-br from-violet-500/20 to-purple-600/20 border border-violet-500/30"
      )}>
        {isGradient ? (
          <Cloud className="h-5 w-5 text-cyan-500" />
        ) : (
          <Cpu className="h-5 w-5 text-violet-500" />
        )}
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">
            {isGradient ? "Gradient AI" : "Open Source"}
          </span>
          {status === 'checking' && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
          {status === 'connected' && (
            <CheckCircle2 className="h-3 w-3 text-green-500" />
          )}
          {status === 'error' && (
            <AlertCircle className="h-3 w-3 text-amber-500" />
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {isGradient 
            ? `Platform Active • ${gradientAgents} agent${gradientAgents !== 1 ? 's' : ''}` 
            : "Local models enabled"}
        </p>
      </div>

      <div className={cn(
        "flex h-6 items-center rounded-full px-2 text-[10px] font-medium transition-colors",
        isGradient 
          ? "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400" 
          : "bg-violet-500/10 text-violet-600 dark:text-violet-400"
      )}>
        {isGradient ? (
          <Zap className="h-3 w-3 mr-1" />
        ) : null}
        {isGradient ? "PRO" : "FREE"}
      </div>
    </motion.div>
  );
}
