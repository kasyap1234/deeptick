"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Brain,
  MessageSquare,
  Plus,
  Search,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { GradientToggle } from "@/components/gradient-toggle";

interface NavItem {
  icon: React.ReactNode;
  label: string;
  href: string;
}

interface SidebarProps {
  className?: string;
  activeTab?: string;
  onNewResearch?: () => void;
  recentConversations?: Array<{ id: string; title: string; updatedAt: string }>;
}

const mainNavItems: NavItem[] = [
  { icon: <Brain className="h-4 w-4" />, label: "Research", href: "/" },
  { icon: <MessageSquare className="h-4 w-4" />, label: "Chat", href: "/chat" },
];

export function Sidebar({
  className,
  activeTab = "research",
  onNewResearch,
  recentConversations = [],
}: SidebarProps) {
  const [isCollapsed] = useState(false);

  return (
    <motion.aside
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "flex h-screen flex-col border-r border-border/50 bg-background/80 backdrop-blur-sm",
        className
      )}
    >
      <div className="flex h-14 items-center justify-between px-4 border-b border-border/50">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-foreground to-foreground/80 shadow-sm">
            <Brain className="h-4 w-4 text-background" />
          </div>
          <span className={cn("font-semibold text-sm tracking-tight", isCollapsed && "hidden")}>
            DeepTick
          </span>
        </Link>
        <ThemeToggle />
      </div>

      <div className="p-3">
        <Button
          onClick={onNewResearch}
          className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
        >
          <Plus className="h-4 w-4" />
          {!isCollapsed && "New Research"}
        </Button>
      </div>

      <ScrollArea className="flex-1 px-3">
        <nav className="flex flex-col gap-1">
          {mainNavItems.map((item) => (
            <Link key={item.label} href={item.href}>
              <Button
                variant={activeTab === item.label.toLowerCase() ? "secondary" : "ghost"}
                className={cn(
                  "w-full justify-start gap-2.5 h-10 text-sm font-medium",
                  activeTab === item.label.toLowerCase() &&
                    "bg-secondary text-foreground"
                )}
              >
                {item.icon}
                {!isCollapsed && (
                  <span className="flex-1 text-left">{item.label}</span>
                )}
              </Button>
            </Link>
          ))}
        </nav>

        {recentConversations.length > 0 && !isCollapsed && (
          <>
            <Separator className="my-3" />
            <div className="mb-2 flex items-center justify-between px-2">
              <span className="text-xs font-medium text-muted-foreground">
                Recent
              </span>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <Search className="h-3 w-3" />
              </Button>
            </div>
            <nav className="flex flex-col gap-0.5">
              {recentConversations.slice(0, 5).map((conv) => (
                <Link key={conv.id} href={`/chat/${conv.id}`}>
                  <Button
                    variant="ghost"
                    className="w-full justify-start gap-2 h-8 text-xs text-muted-foreground hover:text-foreground group"
                  >
                    <MessageSquare className="h-3 w-3 shrink-0" />
                    <span className="truncate flex-1 text-left">{conv.title}</span>
                    <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Button>
                </Link>
              ))}
            </nav>
          </>
        )}
      </ScrollArea>

      <div className="border-t border-border/50 p-3">
        <GradientToggle className="mb-3" />
        <p className="text-[10px] text-muted-foreground text-center">
          DeepTick Research
        </p>
      </div>
    </motion.aside>
  );
}
