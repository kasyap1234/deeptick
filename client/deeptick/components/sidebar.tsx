"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Brain,
  MessageSquare,
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
        "flex h-screen flex-col border-r-2 border-border bg-background relative overflow-hidden",
        className
      )}
    >
      <div className="absolute top-0 bottom-0 left-0 pointer-events-none overflow-hidden z-0 opacity-[0.03]">
        <span className="font-sans text-[140px] font-black tracking-tighter leading-none whitespace-nowrap -rotate-90 origin-bottom-left inline-block -translate-x-4 translate-y-full">
          TERMINAL
        </span>
      </div>

      <div className="flex h-20 items-center justify-between px-6 border-b-2 border-border relative z-10 bg-background/80 backdrop-blur-sm">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center border-2 border-foreground bg-foreground text-background">
            <Brain className="h-5 w-5" />
          </div>
          <span className={cn("font-serif font-bold text-2xl tracking-tight", isCollapsed && "hidden")}>
            DeepTick
          </span>
        </Link>
        <ThemeToggle />
      </div>

      <div className="p-6 border-b border-border relative z-10 bg-background">
        <Button
          onClick={onNewResearch}
          className="w-full gap-3 bg-background text-foreground hover:bg-foreground hover:text-background rounded-none font-mono uppercase tracking-widest text-[10px] border-2 border-foreground transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,0.1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-none h-12"
        >
          <div className="w-2 h-2 border border-current bg-transparent flex items-center justify-center">
            <div className="w-1 h-1 bg-current animate-pulse" />
          </div>
          {!isCollapsed && "INITIALIZE QUERY"}
        </Button>
      </div>

      <ScrollArea className="flex-1 px-4 py-4 relative z-10">
        <nav className="flex flex-col gap-2">
          {mainNavItems.map((item) => {
            const isActive = activeTab === item.label.toLowerCase();
            return (
              <Link
                key={item.label}
                href={item.href}
                className={cn(
                  "w-full flex items-center justify-start gap-3 h-12 text-[10px] font-mono uppercase tracking-widest rounded-none border border-border transition-all px-4",
                  isActive
                    ? "bg-foreground text-background border-foreground font-bold"
                    : "bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground hover:border-foreground/50"
                )}
              >
                  <div className={cn(
                    "w-3 h-3 border flex items-center justify-center",
                    isActive ? "border-background" : "border-muted-foreground"
                  )}>
                    {isActive && <div className="w-1.5 h-1.5 bg-background" />}
                  </div>
                  {!isCollapsed && (
                    <span className="flex-1 text-left">{item.label}</span>
                  )}
              </Link>
            );
          })}
        </nav>

        {recentConversations.length > 0 && !isCollapsed && (
          <>
            <Separator className="my-3" />
            <div className="mb-2 flex items-center justify-between px-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Recent
              </span>
              <Button variant="ghost" size="icon" className="h-6 w-6 rounded-none">
                <Search className="h-3 w-3" />
              </Button>
            </div>
            <nav className="flex flex-col gap-0.5">
              {recentConversations.slice(0, 5).map((conv) => (
                <Link
                  key={conv.id}
                  href={`/chat/${conv.id}`}
                  className="w-full flex items-center justify-start gap-2 h-8 text-[11px] font-mono text-muted-foreground hover:text-foreground group rounded-none px-4"
                >
                    <MessageSquare className="h-3 w-3 shrink-0" />
                    <span className="truncate flex-1 text-left">{conv.title}</span>
                    <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                </Link>
              ))}
            </nav>
          </>
        )}
      </ScrollArea>

      <div className="border-t-2 border-border p-4 relative z-10 bg-background/95 backdrop-blur-sm">
        <GradientToggle className="mb-4 rounded-none font-mono text-[10px] uppercase w-full border border-border h-10" />
        <div className="flex items-center justify-between text-[8px] font-mono uppercase tracking-widest text-muted-foreground border-t border-border pt-4">
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
            SYS.ONLINE
          </div>
          <span>v2.4.0_REV_B</span>
        </div>
      </div>
    </motion.aside>
  );
}
