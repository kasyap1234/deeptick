"use client";

import { motion } from "framer-motion";
import { Brain, Search, FileText, Bot, Users, CheckCircle, Cloud, Cpu, Database, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useGradient } from "@/lib/api";

const features = [
  {
    icon: Brain,
    title: "AI Analysis",
    description: "Advanced models analyze financial data and market sentiment",
  },
  {
    icon: Search,
    title: "Deep Research",
    description: "Searches across 80+ sources for comprehensive insights",
  },
  {
    icon: FileText,
    title: "Reports",
    description: "Institutional-grade research with bull/bear cases",
  },
  {
    icon: Bot,
    title: "Chat",
    description: "Ask follow-up questions and get contextual answers",
  },
  {
    icon: Users,
    title: "Multi-Agent",
    description: "18 specialized agents collaborate for analysis",
  },
  {
    icon: CheckCircle,
    title: "Verified",
    description: "All claims cited and auditable",
  },
];

const gradientFeatures = [
  {
    icon: Cloud,
    title: "Gradient Agents",
    description: "Native AI agents with custom instructions",
  },
  {
    icon: Database,
    title: "Knowledge Base",
    description: "RAG-powered retrieval with your data",
  },
  {
    icon: Zap,
    title: "Serverless",
    description: "Scale infinitely with managed inference",
  },
  {
    icon: Cpu,
    title: "Full Stack",
    description: "Training to deployment on one platform",
  },
];

export function EmptyState({ onStartResearch }: { onStartResearch: () => void }) {
  const isGradient = useGradient;

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="mb-8"
      >
        <div className={cn(
          "flex h-20 w-20 items-center justify-center rounded-2xl border-2 mb-4 mx-auto",
          isGradient 
            ? "bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border-cyan-500/30" 
            : "bg-gradient-to-br from-violet-500/20 to-purple-600/20 border-violet-500/30"
        )}>
          <Brain className={cn(
            "h-10 w-10",
            isGradient ? "text-cyan-500" : "text-violet-500"
          )} />
        </div>
        {isGradient && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="flex items-center justify-center gap-2"
          >
            <Badge className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white border-0 gap-1">
              <Zap className="h-3 w-3" />
              Gradient AI Powered
            </Badge>
          </motion.div>
        )}
      </motion.div>

      <motion.h2
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="text-3xl font-bold mb-3 bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent"
      >
        DeepTick
      </motion.h2>

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="text-muted-foreground max-w-md mb-6 text-sm"
      >
        {isGradient 
          ? "AI-powered research assistant powered by Gradient AI Platform with native agents and knowledge bases."
          : "AI-powered research assistant for institutional-grade investment analysis using open source models."}
      </motion.p>

      {isGradient && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-2 w-full max-w-2xl mb-8"
        >
          {gradientFeatures.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 + index * 0.05 }}
              className="p-3 rounded-xl bg-gradient-to-br from-cyan-500/5 to-blue-500/5 border border-cyan-500/10"
            >
              <feature.icon className="h-5 w-5 text-cyan-500 mx-auto mb-2" />
              <p className="text-xs font-medium text-cyan-700 dark:text-cyan-300">{feature.title}</p>
              <p className="text-[10px] text-muted-foreground">{feature.description}</p>
            </motion.div>
          ))}
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 w-full max-w-3xl"
      >
        {features.map((feature, index) => (
          <motion.div
            key={feature.title}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 + index * 0.05 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <Card
              className={cn(
                "border border-border bg-card h-full cursor-pointer overflow-hidden",
                "hover:border-foreground/30 transition-all duration-200 hover:shadow-md",
                isGradient && "hover:border-cyan-500/20 hover:shadow-cyan-500/5"
              )}
              onClick={onStartResearch}
            >
              <CardContent className="p-4 flex flex-col items-center text-center relative">
                <div className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-lg border mb-3 transition-colors",
                  isGradient 
                    ? "bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border-cyan-500/20" 
                    : "bg-gradient-to-br from-violet-500/10 to-purple-500/10 border-violet-500/20"
                )}>
                  <feature.icon className={cn(
                    "h-5 w-5",
                    isGradient ? "text-cyan-500" : "text-violet-500"
                  )} />
                </div>
                <h3 className="font-semibold text-sm mb-1">{feature.title}</h3>
                <p className="text-xs text-muted-foreground">{feature.description}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
