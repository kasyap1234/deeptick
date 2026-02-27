"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { MessageSquare, Loader2, TrendingUp, Building2, DollarSign, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface NewChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (title: string, context?: Record<string, unknown>) => void;
  isLoading?: boolean;
}

const quickPrompts = [
  { icon: TrendingUp, label: "Tesla stock analysis" },
  { icon: Building2, label: "Tech sector outlook" },
  { icon: DollarSign, label: "Crypto market trends" },
  { icon: Globe, label: "Global macro analysis" },
];

export function NewChatDialog({
  open,
  onOpenChange,
  onSubmit,
  isLoading,
}: NewChatDialogProps) {
  const [title, setTitle] = useState("");
  const [stock, setStock] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    
    const context: Record<string, unknown> = {};
    if (stock.trim()) {
      context.currentStock = stock.trim().toUpperCase();
    }
    
    onSubmit(title, Object.keys(context).length > 0 ? context : undefined);
    setTitle("");
    setStock("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg gradient-card border-border/50">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <MessageSquare className="h-5 w-5 text-teal-500" />
            New Conversation
          </DialogTitle>
          <DialogDescription>
            Start a new chat to discuss your research and get AI-powered insights.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 mt-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Quick Topics</label>
            <div className="grid grid-cols-2 gap-2">
              {quickPrompts.map((prompt, index) => (
                <motion.button
                  key={index}
                  type="button"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  onClick={() => setTitle(prompt.label)}
                  className={cn(
                    "flex items-center gap-2 p-3 text-sm text-left rounded-lg border border-border/50",
                    "hover:border-primary/50 hover:bg-primary/5 transition-colors",
                    title === prompt.label && "border-primary bg-primary/10"
                  )}
                >
                  <prompt.icon className="h-4 w-4 text-primary shrink-0" />
                  <span className="truncate">{prompt.label}</span>
                </motion.button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="title" className="text-sm font-medium">
              Conversation Title
            </label>
            <Input
              id="title"
              placeholder="e.g., Tesla Q4 Analysis"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-11"
            />
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {showAdvanced ? "Hide" : "Show"} Context Options
            </button>

            {showAdvanced && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="space-y-4 overflow-hidden"
              >
                <div className="space-y-2">
                  <label htmlFor="stock" className="text-sm font-medium">
                    Focus Stock/Ticker (Optional)
                  </label>
                  <Input
                    id="stock"
                    placeholder="e.g., TSLA, AAPL, BTC"
                    value={stock}
                    onChange={(e) => setStock(e.target.value.toUpperCase())}
                  />
                </div>
              </motion.div>
            )}
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
              disabled={!title.trim() || isLoading}
              className="gap-2 bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <MessageSquare className="h-4 w-4" />
                  Start Chat
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
