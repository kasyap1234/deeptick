"use client";

import { motion } from "framer-motion";
import { Brain, Search, FileText, Bot, Users, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

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
    description: "Seven specialized agents collaborate for analysis",
  },
  {
    icon: CheckCircle,
    title: "Verified",
    description: "All claims cited and auditable",
  },
];

export function EmptyState({ onStartResearch }: { onStartResearch: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="mb-8"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-foreground bg-foreground">
          <Brain className="h-8 w-8 text-background" />
        </div>
      </motion.div>

      <motion.h2
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="text-2xl font-semibold mb-3"
      >
        DeepTick
      </motion.h2>

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="text-muted-foreground max-w-md mb-8 text-sm"
      >
        AI-powered research assistant for institutional-grade investment analysis.
      </motion.p>

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
            transition={{ delay: 0.2 + index * 0.05 }}
          >
            <Card
              className={cn(
                "border border-border bg-card h-full cursor-pointer",
                "hover:border-foreground/30 transition-colors duration-200"
              )}
              onClick={onStartResearch}
            >
              <CardContent className="p-4 flex flex-col items-center text-center">
                <div className="flex h-8 w-8 items-center justify-center rounded border border-border mb-3">
                  <feature.icon className="h-4 w-4 text-foreground" />
                </div>
                <h3 className="font-medium text-sm mb-1">{feature.title}</h3>
                <p className="text-xs text-muted-foreground">{feature.description}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
